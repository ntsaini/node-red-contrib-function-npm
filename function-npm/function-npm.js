module.exports = function(RED) {
    "use strict";
    var util = require("util");    
    var vm = require("vm");
    var npm = require("npm");
    var events = require('events');
    var strip = require('strip-comments');
    var temp = require("temp").track();
    var tempDir = temp.mkdirSync();
    var tempNodeModulesPath = tempDir + "/node_modules/"

    var eventEmitter = new events.EventEmitter();

    function sendResults(node,_msgid,msgs) {
        if (msgs == null) {
            return;
        } else if (!util.isArray(msgs)) {
            msgs = [msgs];
        }
        var msgCount = 0;
        for (var m=0; m<msgs.length; m++) {
            if (msgs[m]) {
                if (!util.isArray(msgs[m])) {
                    msgs[m] = [msgs[m]];
                }
                for (var n=0; n < msgs[m].length; n++) {
                    var msg = msgs[m][n];
                    if (msg !== null && msg !== undefined) {
                        if (typeof msg === 'object' && !Buffer.isBuffer(msg) && !util.isArray(msg)) {
                            msg._msgid = _msgid;
                            msgCount++;
                        } else {
                            var type = typeof msg;
                            if (type === 'object') {
                                type = Buffer.isBuffer(msg)?'Buffer':(util.isArray(msg)?'Array':'Date');
                            }
                            node.error(RED._("function.error.non-message-returned",{ type: type }))
                        }
                    }
                }
            }
        }
        if (msgCount>0) {
            node.send(msgs);
        }
    }

    function FunctionNPMNode(n) {
        RED.nodes.createNode(this,n);        
        var node = this;
        this.name = n.name;
        this.func = n.func;
        var functionText = "var results = null;"+
                           "results = (function(msg){ "+
                              "var __msgid__ = msg._msgid;"+
                              "var node = {"+
                                 "log:__node__.log,"+
                                 "error:__node__.error,"+
                                 "warn:__node__.warn,"+
                                 "on:__node__.on,"+
                                 "status:__node__.status,"+
                                 "send:function(msgs){ __node__.send(__msgid__,msgs);}"+
                              "};\n"+
                              this.func+"\n"+
                           "})(msg);";
        this.topic = n.topic;
        this.outstandingTimers = [];
        this.outstandingIntervals = [];
        var sandbox = {
            console:console,
            util:util,
            Buffer:Buffer,
            RED: {
                util: RED.util
            },
            __node__: {
                log: function() {
                    node.log.apply(node, arguments);
                },
                error: function() {
                    node.error.apply(node, arguments);
                },
                warn: function() {
                    node.warn.apply(node, arguments);
                },
                send: function(id, msgs) {
                    sendResults(node, id, msgs);
                },
                on: function() {
                    if (arguments[0] === "input") {
                        throw new Error(RED._("function.error.inputListener"));
                    }
                    node.on.apply(node, arguments);
                },
                status: function() {
                    node.status.apply(node, arguments);
                }
            },
            context: {
                set: function() {
                    node.context().set.apply(node,arguments);
                },
                get: function() {
                    return node.context().get.apply(node,arguments);
                },
                keys: function() {
                    return node.context().keys.apply(node,arguments);
                },
                get global() {
                    return node.context().global;
                },
                get flow() {
                    return node.context().flow;
                }
            },
            flow: {
                set: function() {
                    node.context().flow.set.apply(node,arguments);
                },
                get: function() {
                    return node.context().flow.get.apply(node,arguments);
                },
                keys: function() {
                    return node.context().flow.keys.apply(node,arguments);
                }
            },
            global: {
                set: function() {
                    node.context().global.set.apply(node,arguments);
                },
                get: function() {
                    return node.context().global.get.apply(node,arguments);
                },
                keys: function() {
                    return node.context().global.keys.apply(node,arguments);
                }
            },
            setTimeout: function () {
                var func = arguments[0];
                var timerId;
                arguments[0] = function() {
                    sandbox.clearTimeout(timerId);
                    try {
                        func.apply(this,arguments);
                    } catch(err) {
                        node.error(err,{});
                    }
                };
                timerId = setTimeout.apply(this,arguments);
                node.outstandingTimers.push(timerId);
                return timerId;
            },
            clearTimeout: function(id) {
                clearTimeout(id);
                var index = node.outstandingTimers.indexOf(id);
                if (index > -1) {
                    node.outstandingTimers.splice(index,1);
                }
            },
            setInterval: function() {
                var func = arguments[0];
                var timerId;
                arguments[0] = function() {
                    try {
                        func.apply(this,arguments);
                    } catch(err) {
                        node.error(err,{});
                    }
                };
                timerId = setInterval.apply(this,arguments);
                node.outstandingIntervals.push(timerId);
                return timerId;
            },
            clearInterval: function(id) {
                clearInterval(id);
                var index = node.outstandingIntervals.indexOf(id);
                if (index > -1) {
                    node.outstandingIntervals.splice(index,1);
                }
            }
        };
        if (util.hasOwnProperty('promisify')) {
            sandbox.setTimeout[util.promisify.custom] = function(after, value) {
                return new Promise(function(resolve, reject) {
                    sandbox.setTimeout(function(){ resolve(value) }, after);
                });
            }
        }
        
        var requiredModules = [];
        var installedModules = {};
        var npmModules = [];
        const RE_SCOPED = /^(@[^/]+\/[^/@]+)(?:\/([^@]+))?(?:@([\s\S]+))?/;
        const RE_NORMAL = /^([^/@]+)(?:\/([^@]+))?(?:@([\s\S]+))?/;


        /*
        Get the required modules by parsing code
        
        require\( : match require followed by opening parentheses
        ( : begin capturing group
        [^)]+: match one or more non ) characters
        ) : end capturing group
        \) : match closing parentheses            
        */
        var pattern = /require\(([^)]+)\)/g
        var functionTextwoComments = strip(functionText);
        var result = pattern.exec(functionTextwoComments);
        
        while(result != null){
            var module_name = result[1];
            //replace quotes if any
            module_name = module_name.replace(/'/g,"");
            module_name = module_name.replace(/"/g,"");

            var matched = module_name.charAt(0) === "@" ? module_name.match(RE_SCOPED) : module_name.match(RE_NORMAL);
            var moduleNameOnly = matched[1];
            var modulePath = matched[2] || '';
            var moduleVersion = matched[3] || '';
            requiredModules.push({name: moduleNameOnly, path: modulePath, version: moduleVersion, fullName: module_name});
            result = pattern.exec(functionTextwoComments);
        }
        
        requiredModules.forEach(function(npmModule) {
            var moduleFullPath = npmModule.path === '' ? tempNodeModulesPath + npmModule.name : tempNodeModulesPath + npmModule.path;
            if (installedModules[npmModule.fullName]) {                
                npmModules[npmModule.fullName] = require(moduleFullPath);
              } 
            else {
                node.status({fill:"blue",shape:"dot",text:"installing"});
                npm.load({prefix: tempDir, progress: false, loglevel: 'silent'}, function (er) {
                    if (er) return node.error(er);
            
                    npm.commands.install([npmModule.fullName], function (er, data) {                        
                        if (er) {
                            node.status({fill:"red",shape:"dot",text:"failed"});
                            installedModules[npmModule.fullName] = false;
                            return node.error(er)
                        }
            
                        try {                                                    
                            npmModules[npmModule.fullName] = require(moduleFullPath);                            
                            node.status({fill:"green",shape:"dot",text:"ready"});
                            setTimeout(node.status.bind(node, {}), 2000)
                            node.log('Downloaded and installed NPM module: ' + npmModule.fullName)
                            installedModules[npmModule.fullName] = true
                        } catch (err) {
                            node.error(err)
                            node.status({fill:"red",shape:"dot",text:"failed"});
                            installedModules[npmModule.fullName] = false;
                        }
                  })
                })
              }
        }, this);
        
        var checkPackageLoad = function(){
            var downloadProgressResult = null;
            //check that the required modules are processed
            if(requiredModules.length != 0){
                requiredModules.forEach(function(npmModule) {
                    if (!(installedModules.hasOwnProperty(npmModule.fullName))){                        
                        downloadProgressResult = false;
                    }
                    else{
                        downloadProgressResult = (downloadProgressResult !== null) ? (downloadProgressResult && true) : true
                    }
                }, this);
            }
            else{
                downloadProgressResult = true;
            }
            return downloadProgressResult;
        }

        var requireOverload = function(moduleName){
            try {                
                return npmModules[moduleName]; 
            } catch(err){
                node.error("Cannot find module : " + moduleName);
            }            
        };

        //Add modules to the context
        sandbox.__npmModules__ = npmModules;
        sandbox.require = requireOverload;

        var context = vm.createContext(sandbox);
        try {
            node.script = vm.createScript(functionText);
            
            node.on("input", function(msg) {
                
                //configure the event first
                eventEmitter.on('load-complete',function(){                    
                    try {
                        var start = process.hrtime();
                        context.msg = msg;
                        node.script.runInContext(context);
                        sendResults(node,msg._msgid,context.results);
    
                        var duration = process.hrtime(start);
                        var converted = Math.floor((duration[0] * 1e9 + duration[1])/10000)/100;
                        node.metric("duration", msg, converted);
                        if (process.env.NODE_RED_FUNCTION_TIME) {
                            node.status({fill:"yellow",shape:"dot",text:""+converted});
                        }
                    } catch(err) {
    
                        var line = 0;
                        var errorMessage;
                        var stack = err.stack.split(/\r?\n/);
                        if (stack.length > 0) {
                            while (line < stack.length && stack[line].indexOf("ReferenceError") !== 0) {
                                line++;
                            }
    
                            if (line < stack.length) {
                                errorMessage = stack[line];
                                var m = /:(\d+):(\d+)$/.exec(stack[line+1]);
                                if (m) {
                                    var lineno = Number(m[1])-1;
                                    var cha = m[2];
                                    errorMessage += " (line "+lineno+", col "+cha+")";
                                }
                            }
                        }
                        if (!errorMessage) {
                            errorMessage = err.toString();
                        }
                        node.error(errorMessage, msg);
                    }
                    eventEmitter.removeAllListeners('load-complete');
                });

                //Check is the npm packages are loaded, if not wait for 1 sec and check again                
                if(!checkPackageLoad()){
                    var intervalId = setInterval(function() {
                        if(!checkPackageLoad()){
                            node.status("Waiting for package download");                            
                        }
                        else {
                            eventEmitter.emit('load-complete');
                            clearInterval(intervalId);
                        }
                    }, 1000);
                }
                else{                    
                    eventEmitter.emit('load-complete');
                }
            });
            
            node.on("close", function() {
                while (node.outstandingTimers.length > 0) {
                    clearTimeout(node.outstandingTimers.pop())
                }
                while (node.outstandingIntervals.length > 0) {
                    clearInterval(node.outstandingIntervals.pop())
                }
                node.status({});
            })
        } catch(err) {
            // eg SyntaxError - which v8 doesn't include line number information
            // so we can't do better than this
            node.error(err);
        }
    }
    RED.nodes.registerType("function-npm",FunctionNPMNode);
    RED.library.register("functions");
}