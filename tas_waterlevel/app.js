var net = require('net');
var util = require('util');
var fs = require('fs');
var xml2js = require('xml2js');

var wdt = require('./wdt');

var useparentport = '';
var useparenthostname = '';

var upload_arr = [];
var download_arr = [];

var conf = {};

fs.readFile('conf.xml', 'utf-8', function (err, data) {
    if (err) {
        console.log("FATAL An error occurred trying to read in the file: " + err);
        console.log("error : set to default for configuration")
    }
    else {
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(data, function (err, result) {
            if (err) {
                console.log("Parsing An error occurred trying to read in the file: " + err);
                console.log("error : set to default for configuration")
            }
            else {
                var jsonString = JSON.stringify(result);
                conf = JSON.parse(jsonString)['m2m:conf'];

                useparenthostname = conf.tas.parenthostname;
                useparentport = conf.tas.parentport;

                if (conf.upload != null) {
                    if (conf.upload['ctname'] != null) {
                        upload_arr[0] = conf.upload;
                    }
                    else {
                        upload_arr = conf.upload;
                    }
                }

                if (conf.download != null) {
                    if (conf.download['ctname'] != null) {
                        download_arr[0] = conf.download;
                    }
                    else {
                        download_arr = conf.download;
                    }
                }
            }
        });
    }
});

var tas_state = 'init';
var upload_client = null;
var t_count = 0;
var tas_download_count = 0;

function on_receive(data) {
    if (tas_state == 'connect' || tas_state == 'reconnect' || tas_state == 'upload') {
        var data_arr = data.toString().split('<EOF>');
        if (data_arr.length >= 2) {
            for (var i = 0; i < data_arr.length - 1; i++) {
                var line = data_arr[i];
                var sink_str = util.format('%s', line.toString());
                var sink_obj = JSON.parse(sink_str);

                if (sink_obj.ctname == null || sink_obj.con == null) {
                    console.log('Received: data format mismatch');
                }
                else {
                    if (sink_obj.con == 'hello') {
                        console.log('Received: ' + line);

                        if (++tas_download_count >= download_arr.length) {
                            tas_state = 'upload';
                        }
                    }
                    else {
                        for (var j = 0; j < upload_arr.length; j++) {
                            if (upload_arr[j].ctname == sink_obj.ctname) {
                                console.log('ACK : ' + line + ' <----');
                                break;
                            }
                        }

                        for (j = 0; j < download_arr.length; j++) {
                            if (download_arr[j].ctname == sink_obj.ctname) {
                                g_down_buf = JSON.stringify({id: download_arr[i].id, con: sink_obj.con});
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
    if (tas_state == 'init') {
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
    }
    else if (tas_state == 'init_thing') {
        
        tas_state = 'connect';
    }
    else if (tas_state == 'connect' || tas_state == 'reconnect') {
        upload_client.connect(useparentport, useparenthostname, function() {
            console.log('upload Connected');
            tas_download_count = 0;
            for (var i = 0; i < download_arr.length; i++) {
                console.log('download Connected - ' + download_arr[i].ctname + ' hello');
                var cin = {ctname: download_arr[i].ctname, con: 'hello'};
                upload_client.write(JSON.stringify(cin) + '<EOF>');
            }

            if (tas_download_count >= download_arr.length) {
                tas_state = 'upload';
            }
        });
    }
}

// TAS가 정상 작동하지 않는지 3초마다 확인
wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);


//센서 데이터 읽기 코드

const spi = require('spi-device');
var rawValue = 0;

var dist_0 = 0; //이전 측정값
var dist_1 = 0; //현재 측정값
var waterlevel_update = false;

//초당 1회 측정
setInterval(() => {
    const waterlevel = spi.open(0, 0, (err) => {
        // SPI 메시지는 하나 이상의 읽기+쓰기 전송으로 구성됨
        const message = [{
            sendBuffer: Buffer.from([0x01, 0x80, 0x00]), // 채널 0을 읽기 위해 보냄
            receiveBuffer: Buffer.alloc(3),              // 채널 5에서 읽은 원시 데이터
            byteLength: 3,
            speedHz: 20000 // SPI 장치로부터 좋은 읽기를 얻기 위해 낮은 버스 속도 사용
        }];
    
        if (err) throw err;
    
        waterlevel.transfer(message, (err, message) => {
            if (err) throw err;

            // 센서로부터 읽은 값을 콘솔에 출력
            rawValue = ((message[0].receiveBuffer[1] & 0x03) << 8) +
                        message[0].receiveBuffer[2];
            // 측정값 범위에 따라 출력 값 설정
            let outputValue;
            if (rawValue < 10) {
                outputValue = -1;
            } else if (rawValue >= 10 && rawValue < 450) {
                outputValue = 0;
            } else if (rawValue >= 450) {
                outputValue = 1;
            } else {
                outputValue = rawValue;
            }
            
            console.log("Raw Value:", rawValue, "Output Value:", outputValue); // 값 출력
            dist_1 = rawValue; // 현재 측정값 저장

            //데이터 전송
            if (tas_state=='upload') {
                for(var i = 0; i < upload_arr.length; i++) {
                    if(upload_arr[i].id != "waterlevel") {
                        var cin = {ctname: upload_arr[i].ctname, con: outputValue};
                        console.log("SEND : " + JSON.stringify(cin) + ' ---->')
                        upload_client.write(JSON.stringify(cin) + '<EOF>');
                        break;
                    }
                }
            }
        });
    });

    // 이전 측정값과 현재 측정값 비교
    if (Math.abs(dist_1 - dist_0) > 100)
        waterlevel_update = true; // 변화가 일정 범위를 초과한 경우
    else
        waterlevel_update = false; // 변화가 일정 범위를 초과하지 않은 경우

    
    dist_0 = dist_1; // 현재 측정값을 이전 측정값으로 업데이트
}, 1000);
