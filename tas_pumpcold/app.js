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

const COLD_ON_PIN = new Gpio(17, 'out');
const COLD_OFF_PIN = new Gpio(18, 'out');

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
        });
    }
}

wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);

setInterval(() => {
    if (tas_state === 'upload') {
        // 여기서는 펌프 제어 액션을 시뮬레이션합니다. 실제 논리로 교체해야 합니다.
        const action = Math.floor(Math.random() * 6) + 1;

        console.log(`Received action: ${action}`);
        
        // Add logic to handle GPIO here based on the action
        // For example, if action is 1 or 2, handle cold water pump ON/OFF
        if (action === 1) {
            console.log('Cold water pump ON');
            COLD_ON_PIN.writeSync(1);
            COLD_OFF_PIN.writeSync(0);
        } else if (action === 2) {
            console.log('Cold water pump OFF');
            COLD_ON_PIN.writeSync(0);
            COLD_OFF_PIN.writeSync(1);
        } else {
            COLD_ON_PIN.writeSync(0);
            COLD_OFF_PIN.writeSync(0);
        }

        for (let i = 0; i < upload_arr.length; i++) {
            if (upload_arr[i].id === "pumpcold#1") {
                const cin = { ctname: upload_arr[i].ctname, con: action };
                console.log("SEND : " + JSON.stringify(cin) + ' ---->');
                upload_client.write(JSON.stringify(cin) + '<EOF>');
                break;
            }
        }
    }
}, 1000);

process.on('SIGINT', () => {
    COLD_ON_PIN.unexport();
    COLD_OFF_PIN.unexport();
    process.exit();
});
