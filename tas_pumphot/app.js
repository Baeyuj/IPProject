const net = require('net');
const net = require('net');
const util = require('util');
const fs = require('fs');
const xml2js = require('xml2js');
const Gpio = require('onoff').Gpio;
const wdt = require('./wdt');

let useparentport = '';
let useparenthostname = '';

let upload_arr = [];
let download_arr = [];

let conf = {};


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

const HOT_ON_PIN = new Gpio(22, 'out'); //22, 23

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
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}

function tas_watchdog() {
    if (tas_state === 'init') {
        upload_client = new net.Socket();

        upload_client.on('data', on_receive);
        upload_client.on('data', handleServerData);

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
    } else if (tas_state === 'connect' || tas_state === 'reconnect') {
        upload_client.connect(3000, useparenthostname, function() {
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
        });
    }
}

wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);

// 데이터를 수신했을 때 호출되는 함수입니다.
function handleServerData(data) {
    // 서버로부터 받은 데이터를 처리하는 로직을 여기에 추가합니다.
    // 예를 들어, 서버로부터 받은 값을 pumpAction 변수에 할당하여 해당 값을 기반으로 펌프를 제어합니다.
    const pumpAction = parseInt(data); // 받은 데이터를 정수형으로 변환합니다.
    console.log('Received action from server:', pumpAction);
    
    // 액션 값에 따라 GPIO 핀을 제어합니다.
    if (pumpAction === 1) {
        console.log('Turning on the cold water pump.');
        HOT_ON_PIN.writeSync(1); // GPIO 핀을 HIGH로 설정하여 펌프를 켭니다.
    } else if (pumpAction === 0) {
        console.log('Turning off the cold water pump.');
        HOT_ON_PIN.writeSync(0); // GPIO 핀을 LOW로 설정하여 펌프를 끕니다.
    } else {
        console.log('Invalid action received from server:', pumpAction);
    }
}

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

var isMeasuring = false; // 측정 중 여부

// TCP 서버 생성
const server = net.createServer((socket) => {
  console.log('Client connected');

  socket.on('data', (data) => {
    const receivedData = data.toString().trim(); // 수신된 데이터
    console.log('Received:', receivedData);

    if (receivedData === '0') {
      // 측정 중이 아닌 경우에만 측정 중지
      if (isMeasuring) {
        console.log('Measurement stopped');
        isMeasuring = false;
      }
    } else if (receivedData === '1') {
      // 측정 중이 아닌 경우에만 측정 시작
      if (!isMeasuring) {
        console.log('Measurement started');
        isMeasuring = true;
      }
    } else {
      console.log('Invalid command:', receivedData);
    }
  });

  socket.on('end', () => {
    console.log('Client disconnected');
  });
});

const PORT = 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});

