/**
 *
 * onewire adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "onewire",                  // name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.0.0",                    // use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Node.js onewire Adapter",  // Adapter title shown in User Interfaces
 *          "authors":  [                               // Array of authord
 *              "name <mail@onewire.com>"
 *          ]
 *          "desc":         "onewire adapter",          // Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       // possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   // possible values "daemon", "schedule", "subscribe"
 *          "schedule":     "0 0 * * *"                 // cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      // Adapters Log Level
 *      },
 *      "native": {                                     // the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42
 *      }
 *  }
 *
 */

/* jshint -W097 */ // jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
var utils = require(__dirname + '/lib/utils'); // Get common adapter utils

var fs = require('fs');
var path = require('path');


// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.onewire.0
var adapter = utils.adapter('onewire');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function(callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function(id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function(id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function(obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function() {
    main();
});

function main() {

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:

    var round = function(value, exp) {
        if (typeof exp === 'undefined' || +exp === 0)
            return Math.round(value);

        value = +value;
        exp = +exp;

        if (isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0))
            return NaN;

        // Shift
        value = value.toString().split('e');
        value = Math.round(+(value[0] + 'e' + (value[1] ? (+value[1] + exp) : exp)));

        // Shift back
        value = value.toString().split('e');
        return +(value[0] + 'e' + (value[1] ? (+value[1] - exp) : -exp));
    };

    var xSplit = function(string, separators) {
        return string.split(new RegExp(separators.join('|'), 'g')).map(function(bar) {
            return bar.trim();
        });
    };

    function getDirectories(srcpath) {
        return fs.readdirSync(srcpath)
            .filter(file => fs.lstatSync(path.join(srcpath, file)))
    }

    function Worker(directory) {
        var worker = this;
        worker.dir = directory;
        worker.valueSymbol = worker.dir + '.value';
        worker.reachableSymbol = worker.dir + '.reachable';
        worker.value = 0.0;
        worker.reachable = false;

        var checkObjects = function() {
            adapter.log.warn(adapter.name);
            adapter.log.warn(adapter.instance); {
                var obj = adapter.getObject(adapter.name + "." + adapter.instance + "." + worker.valueSymbol);
                adapter.log.warn('obj [' + adapter.name + "." + adapter.instance + "." + worker.valueSymbol + ']: ' + obj);
            } {
                var obj2 = adapter.getObject(worker.valueSymbol);
                adapter.log.warn('obj2 [' + adapter.name + "." + adapter.instance + "." + worker.valueSymbol + ']: ' + obj2);
            }
            adapter.setObject(worker.dir, {
                type: 'channel',
                common: {
                    name: worker.dir
                },
                native: { interval: adapter.config.defaultInterval }
            });

            adapter.setObject(worker.valueSymbol, {
                type: 'value',
                common: {
                    name: 'value',
                    type: 'number',
                    read: 'true',
                    write: 'false',
                    role: 'value.temperature'
                },
                native: {}
            });

            adapter.setObject(worker.reachableSymbol, {
                type: 'state',
                common: {
                    name: 'state',
                    type: 'boolean',
                    read: 'true',
                    write: 'false',
                    role: 'indicator.reachable'
                },
                native: {}
            });
        };

        var readData = function() {
            fs.readFile(adapter.config.path + '/' + worker.dir + '/' + 'w1_slave', 'utf8', function(err, data) {
                if (err) {
                    adapter.log.warn('readFileError: ' + err);
                    return;
                }
                //adapter.log.info('readFile: ' + data);

                var lines = xSplit(data, ["crc=", "t="]);
                lines.forEach(function(value, index) {
                    if (index === 1) {
                        if (value.indexOf("YES") >= 0 && !worker.reachable) {
                            adapter.setState(worker.reachableSymbol, true, true);
                            worker.reachable = true;
                        } else if (value.indexOf("NO") >= 0 && worker.reachable) {
                            adapter.setState(worker.reachableSymbol, false, true);
                            worker.reachable = false;
                        }
                    } else if (index === 2 && worker.reachable) {
                        var x = round(parseFloat(value) / 1000, 2);
                        if (x !== worker.value) {
                            adapter.setState(worker.valueSymbol, x, true);
                            worker.value = x;
                        }
                    }
                });
            });
        };

        worker.start = function() {
            checkObjects();
            readData();
            setInterval(readData, adapter.config.defaultInterval * 1000);
            return this;
        };
    }

     adapter.log.info("path: "+adapter.config.path );

    var workers = [];
    var dirs = getDirectories(adapter.config.path);

    adapter.log.log("found sensors: "+dirs.length );

    dirs.forEach(function(dir) {
        adapter.log.info('dir: ' + dir);
        workers.push(new Worker(dir).start());
    });

    /**
     *
     *      For every state in the system there has to be also an object of type state
     *
     *      Here a simple onewire for a boolean variable named "testVariable"
     *
     *      Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
     *
     */

    adapter.setObject('testVariable', {
        type: 'state',
        common: {
            name: 'testVariable',
            type: 'boolean',
            role: 'indicator'
        },
        native: {}
    });

    // in this onewire all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');


    /**
     *   setState examples
     *
     *   you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
     *
     */

    // the variable testVariable is set to true as command (ack=false)
    adapter.setState('testVariable', true);

    // same thing, but the value is flagged "ack"
    // ack should be always set to true if the value is received from or acknowledged from the target system
    adapter.setState('testVariable', { val: true, ack: true });

    // same thing, but the state is deleted after 30s (getState will return null afterwards)
    adapter.setState('testVariable', { val: true, ack: true, expire: 30 });



    // examples for the checkPassword/checkGroup functions
    adapter.checkPassword('admin', 'iobroker', function(res) {
        console.log('check user admin pw ioboker: ' + res);
    });

    adapter.checkGroup('admin', 'admin', function(res) {
        console.log('check group user admin group admin: ' + res);
    });



}
