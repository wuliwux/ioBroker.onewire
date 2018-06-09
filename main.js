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
var utils = require(__dirname + "/lib/utils"); // Get common adapter utils

var fs = require("fs");
var path = require("path");

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.onewire.0
var adapter = utils.adapter("onewire");

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on("unload", function(callback) {
  try {
    adapter.log.info("cleaned everything up...");
    callback();
  } catch (e) {
    callback();
  }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on("message", function(obj) {
  if (typeof obj == "object" && obj.message) {
    if (obj.command == "send") {
      // Send response in callback if required
      if (obj.callback)
        adapter.sendTo(obj.from, obj.command, "Message received", obj.callback);
    }
  }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on("ready", function() {
  main();
});

function main() {
  // The adapters config (in the instance object everything under the attribute "native") is accessible via
  // adapter.config:

  var round = function(value, exp) {
    if (typeof exp === "undefined" || +exp === 0) return Math.round(value);

    value = +value;
    exp = +exp;

    if (isNaN(value) || !(typeof exp === "number" && exp % 1 === 0)) return NaN;

    value = value.toString().split("e");
    value = Math.round(+(value[0] + "e" + (value[1] ? +value[1] + exp : exp)));

    value = value.toString().split("e");
    return +(value[0] + "e" + (value[1] ? +value[1] - exp : -exp));
  };

  var xSplit = function(string, separators) {
    return string
      .split(new RegExp(separators.join("|"), "g"))
      .map(function(bar) {
        return bar.trim();
      });
  };

  function getDirectories(srcpath) {
    return fs
      .readdirSync(srcpath)
      .filter(file => fs.lstatSync(path.join(srcpath, file)));
  }

  function Worker(directory) {
    var worker = this;
    worker.dir = directory;
    worker.valueSymbol = directory + ".value";
    worker.reachableSymbol = directory + ".reachable";
    worker.value = 0.0;
    worker.reachable = false;

    var checkObjects = function() {
      adapter.log.info("obj: " + JSON.stringify(adapter.getObject(worker.dir)));

      adapter.setObjectNotExists(worker.dir, {
        type: "channel",
        common: {
          read: "true"
        },
        native: {
          interval: adapter.config.defaultInterval
        }
      });

      adapter.setObjectNotExists(worker.valueSymbol, {
        type: "state",
        common: {
          type: "number",
          read: "true",
          write: "true",
          role: "value.temperature"
        },
        native: {}
      });

      adapter.setObjectNotExists(worker.reachableSymbol, {
        type: "state",
        common: {
          type: "boolean",
          read: "true",
          write: "true",
          role: "indicator.reachable"
        },
        native: {}
      });
    };

    var readData = function() {
      fs.readFile(
        adapter.config.path + "/" + worker.dir + "/" + "w1_slave",
        "utf8",
        function(err, data) {
          if (err) {
            adapter.log.warn("readFileError: " + err);
            return;
          }
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
              var x = round(parseFloat(value) / 1000, 1);

              if (x !== worker.value) {
                adapter.log.info(
                  "setState: " +
                    JSON.stringify({
                      valueSymbol: worker.valueSymbol,
                      value: x
                    })
                );
                adapter.setState(worker.valueSymbol, x, true);
                worker.value = x;
              }
            }
          });
        }
      );
    };

    worker.start = function() {
      checkObjects();
      readData();
      setInterval(readData, adapter.config.defaultInterval * 1000);
      return this;
    };
  }
  var workers = [];
  var dirs = getDirectories(adapter.config.path);

  adapter.log.info("found sensors: " + dirs.length);
  dirs
    .filter(function(dir) {
      if (dir.startsWith("w1_bus_master")) return false;
      return true;
    })
    .forEach(function(dir) {
      workers.push(new Worker(dir).start());
    });
}
