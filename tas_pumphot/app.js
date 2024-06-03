const net = require('net');
const util = require('util');
const fs = require('fs');
const xml2js = require('xml2js');
const Gpio = require('onoff').Gpio;
const wdt = require('./wdt');

const http = require('http');

let useparentport = '';
let useparenthostname = '';

let upload_arr = [];


let download_arr = [];

let conf = {};

function fetchCinFromMobius() {
    const options = {
        hostname: '203.253.128.177',
        port: 7579,
        path: '/Mobius/IoTPTeam2/pumpHOT/la',  // 'la'는 latest content instance
        method: 'GET',
        headers: {
            'X-M2M-RI': '12345',
            'X-M2M-Origin': 'SOrigin',
            'Accept': 'application/json'
        }
    };

    const req = http.request(options, res => {
        let data = '';
        res.on('data', chunk => {
            data += chunk;
        });
        res.on('end', () => {
            if (res.statusCode === 200) {
                try {
                    const parsedData = JSON.parse(data);
                    const cin = parsedData['m2m:cin'];
                    if (cin) {
                        console.log('Latest CIN Received:', cin);
                        control_pump(cin.con); // Mobius로부터 받은 데이터를 바탕으로 펌프 제어
                    }
                } catch (e) {
                    console.error('Error parsing JSON:', e);
                }
            } else {
                console.log('Failed to retrieve CIN:', data);
            }
        });
    });

    req.on('error', error => {
        console.error('Error making HTTP request:', error);
    });

    req.end();
}


// 비동기 방식으로 설정 파일(conf.xml)을 읽어옵니다.
fs.readFile('conf.xml', 'utf-8', function (err, data) {
    if (err) {
        console.log("FATAL An error occurred trying to read in the file: " + err);
        console.log("error : set to default for configuration")
    } else {
        const parser = new xml2js.Parser({ explicitArray: false });
        parser.parseString(data, function (err, result) {
            if (err) {
                console.log("Parsing An error occurred trying to read in the file: " + err);
                console.log("error : set to default for configuration")
            } else {
                const jsonString = JSON.stringify(result);
                conf = JSON.parse(jsonString)['m2m:conf'];

                useparenthostname = conf.tas.parenthostname;
                useparentport = conf.tas.parentport;

                if (conf.upload != null) {
                    if (conf.upload['ctname'] != null) {
                        upload_arr[0] = conf.upload;
                    } else {
                        upload_arr = conf.upload;
                    }
                }

                if (conf.download != null) {
                    if (conf.download['ctname'] != null) {
                        download_arr[0] = conf.download;
                    } else {
                        download_arr = conf.download;
                    }
                }
            }
        });
    }
});

let tas_state = 'init';
let upload_client = null;
let tas_download_count = 0;

const HOT_ON_PIN = new Gpio(19, 'out'); //A-1A : 19, A-1B : 26
const HOT_OFF_PIN = new Gpio(26, 'out'); //A-1A : 19, A-1B : 26

function on_receive(data) {
    if (tas_state === 'connect' || tas_state === 'reconnect' || tas_state === 'upload') {
        const data_arr = data.toString().split('<EOF>');
        if (data_arr.length >= 2) {
            for (let i = 0; i < data_arr.length - 1; i++) {
                const line = data_arr[i];
                const sink_str = util.format('%s', line.toString());
                const sink_obj = JSON.parse(sink_str);

                if (sink_obj.ctname == null || sink_obj.con == null) {
                    console.log('Received: data format mismatch');
                } else {
                    if (sink_obj.con === 'hello') {
                        console.log('Received: ' + line);

                        if (++tas_download_count >= download_arr.length) {
                            tas_state = 'upload';
                        }
                    } else {
                        for (let j = 0; j < upload_arr.length; j++) {
                            if (upload_arr[j].ctname === sink_obj.ctname) {
                                console.log('ACK : ' + line + ' <----');
                                break;
                            }
                        }

                        for (let j = 0; j < download_arr.length; j++) {
                            if (download_arr[j].ctname === sink_obj.ctname) {
                                const g_down_buf = JSON.stringify({ id: download_arr[i].id, con: sink_obj.con });
                                console.log(g_down_buf + ' <----');
                                control_pump(sink_obj.con); //추가
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}

function control_pump(comm_num) {
    const action = parseInt(comm_num); // 받은 데이터를 정수형으로 변환합니다.
    if (action === 1) {
        console.log('Turning on the HOT water pump.');
        HOT_ON_PIN.writeSync(1); // GPIO 핀을 HIGH로 설정하여 펌프를 켭니다.
    } else if (action === 0) {
        console.log('Turning off the HOT water pump.');
        HOT_ON_PIN.writeSync(0); // GPIO 핀을 LOW로 설정하여 펌프를 끕니다.
    } else {
        console.log('Invalid pump command:', action);
    }
}

function startDataFetching() {
    // Mobius로부터 데이터를 주기적으로 가져오기 시작합니다.
    // 예를 들어, 매 10초마다 Mobius로부터 최신 CIN을 요청합니다.
    setInterval(fetchCinFromMobius, 1000); // 10,000밀리초(10초) 간격으로 설정
}

function tas_watchdog() {
    if (tas_state === 'init') {
        upload_client = new net.Socket();

        upload_client.on('data', on_receive);

        upload_client.on('error', function(err) {
            console.log(err);
            tas_state = 'reconnect';
        });

        upload_client.on('close', function() {
            console.log('Connection closed');
            upload_client.destroy();
            tas_state = 'reconnect';
        });

        if (upload_client) {
            console.log('tas init ok');
            tas_state = 'init_thing';
        }
    } else if (tas_state === 'init_thing') {
        tas_state = 'connect';
        control_pump('0'); //추가
    } else if (tas_state === 'connect' || tas_state === 'reconnect') {
        upload_client.connect(useparentport, useparenthostname, function() {
            console.log('upload Connected');
            tas_download_count = 0;
            for (let i = 0; i < download_arr.length; i++) {
                console.log('download Connected - ' + download_arr[i].ctname + ' hello');
                const cin = { ctname: download_arr[i].ctname, con: 'hello' };
                upload_client.write(JSON.stringify(cin) + '<EOF>');
            }

            if (tas_download_count >= download_arr.length) {
                tas_state = 'upload';
            }
            startDataFetching();
        });
    }
}

wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);



// 타임 아웃을 설정하고, 주기적으로 TAS의 상태를 체크하는 함수입니다.
function monitorTAS() {
    // 이전의 TAS 워치독 코드는 그대로 사용합니다.
    // ...
}

// 3초마다 TAS의 상태를 체크합니다.
wdt.set_wdt(require('shortid').generate(), 3, monitorTAS);

// 프로세스 종료 시 GPIO 리소스를 해제합니다.
process.on('SIGINT', () => {
    HOT_ON_PIN.unexport();
    process.exit();
});
