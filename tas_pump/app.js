const express = require('express');
const bodyParser = require('body-parser');
const rpio = require('rpio');
const fs = require('fs');
const xml2js = require('xml2js');
const wdt = require('./wdt');

const app = express();
app.use(bodyParser.json());

const conf = fs.readFileSync('conf.xml', 'utf8');
const parser = new xml2js.Parser({ explicitArray: false });

let PORT, ENDPOINT;

parser.parseString(conf, (err, result) => {
    if (err) {
        console.error('Error parsing XML:', err);
        process.exit(1);
    }

    const tas_pump = result.conf.tas;
    const service = result.conf.service;

    PORT = parseInt(tas_pump.port, 10);
    ENDPOINT = service.endpoint;

    // GPIO 핀 설정
    const COLD_WATER_ON = 17;
    const HOT_WATER_ON = 27;
    const DRAIN_WATER_ON = 22;

    rpio.init({ mapping: 'gpio' });
    rpio.open(COLD_WATER_ON, rpio.OUTPUT, rpio.LOW);
    rpio.open(HOT_WATER_ON, rpio.OUTPUT, rpio.LOW);
    rpio.open(DRAIN_WATER_ON, rpio.OUTPUT, rpio.LOW);

    function controlPump(action) {
        switch (action) {
            case 1:
                rpio.write(COLD_WATER_ON, rpio.HIGH);
                break;
            case 2:
                rpio.write(COLD_WATER_ON, rpio.LOW);
                break;
            case 3:
                rpio.write(HOT_WATER_ON, rpio.HIGH);
                break;
            case 4:
                rpio.write(HOT_WATER_ON, rpio.LOW);
                break;
            case 5:
                rpio.write(DRAIN_WATER_ON, rpio.HIGH);
                break;
            case 6:
                rpio.write(DRAIN_WATER_ON, rpio.LOW);
                break;
            default:
                return { status: 'error', message: 'Invalid action' };
        }
        return { status: 'success', action: action };
    }

    app.post(ENDPOINT, (req, res) => {
        const action = req.body.action;
        const result = controlPump(action);
        res.json(result);
    });

    app.listen(PORT, () => {
        console.log(`Pump control server running at port ${PORT}`);
    });

    wdt.set_wdt('watchdog1', 5, () => {
        console.log('Watchdog Timer triggered');
    });
});

setInterval(() => {
    if (tas_state === 'upload') {
        const action = Math.floor(Math.random() * 6) + 1;

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
