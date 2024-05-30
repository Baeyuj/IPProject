const net = require('net');
const util = require('util');
const fs = require('fs');
const xml2js = require('xml2js');
const rpio = require('rpio');
const wdt = require('./wdt');

let useparentport = '';
let useparenthostname = '';

let upload_arr = [];
let download_arr = [];

let conf = {};

// This is an async file read
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
let t_count = 0;
let tas_download_count = 0;

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
        // GPIO 핀 설정
        const LUKEWARM_ON_PIN = 17;
        const LUKEWARM_OFF_PIN = 18;
        const HOT_ON_PIN = 22;
        const HOT_OFF_PIN = 23;
        const DRAIN_ON_PIN = 24;
        const DRAIN_OFF_PIN = 25;

        // GPIO 초기화
        rpio.init({ mapping: 'gpio' }); // BCM 모드를 설정합니다.
        rpio.open(LUKEWARM_ON_PIN, rpio.OUTPUT, rpio.LOW);
        rpio.open(LUKEWARM_OFF_PIN, rpio.OUTPUT, rpio.LOW);
        rpio.open(HOT_ON_PIN, rpio.OUTPUT, rpio.LOW);
        rpio.open(HOT_OFF_PIN, rpio.OUTPUT, rpio.LOW);
        rpio.open(DRAIN_ON_PIN, rpio.OUTPUT, rpio.LOW);
        rpio.open(DRAIN_OFF_PIN, rpio.OUTPUT, rpio.LOW);

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

// Every 3 seconds, check if the TAS is not working
wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);

const filepath = '/sys/bus/w1/devices/28-3ce1d4439e4f/temperature';

// Trigger a pump control action once per second
setInterval(() => {
    if (tas_state === 'upload') {
        // Here we simulate pump control action. This should be replaced with actual logic to read sensor data or receive commands.
        const action = Math.floor(Math.random() * 6) + 1; // Simulate random pump control action

        for (let i = 0; i < upload_arr.length; i++) {
            if (upload_arr[i].id === "pump") {
                const cin = { ctname: upload_arr[i].ctname, con: action };
                console.log("SEND : " + JSON.stringify(cin) + ' ---->');
                upload_client.write(JSON.stringify(cin) + '<EOF>');
                break;
            }
        }
    }
}, 1000);
