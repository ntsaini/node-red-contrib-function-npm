module.exports = function(RED) {
    "use strict";
    var util = require("util");
    var vm = require("vm");
    
    /*start function-npm specific code*/    
    /**********************************/
    var strip = require('strip-comments');
    var temp = require('temp').track();
    var { npmInstallTo } = require('npm-install-to');
        
    /*start global variables*/
    
    //one common temp dir for all instances
    var tempDirAllInstances = temp.mkdirSync();
    //this variable will store reference for modules for all instances
    const allInstancesRequiredModules = {};
    
    /*end global variables*/
    
    const registerAndLoadModule = function(module, allModulesList){
        //if it isn't already in the list
        if(!allModulesList[module.fullName]){            
            allModulesList[module.fullName] = {
                name: module.name,
                fullName: module.fullName,
                status: ModuleInstallStatus.Installing,
                error: null,
                requireReference: null
            };
            loadModule(module.fullName, tempDirAllInstances)
            .then(function(modulePath){
                let mod = allModulesList[module.fullName];
                mod.requireReference = require(modulePath);
                mod.status = ModuleInstallStatus.Installed;
            }).catch(function(err){
                let mod = allModulesList[module.fullName];
                mod.error = err.message;
                mod.status = ModuleInstallStatus.Error;
            });        
        }
    }
    
    const ModuleInstallStatus = {        
        Installing: 1,
        Installed: 2,
        Error: 3,
    }
    const getRequiredModules = function(functionText){        
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
        let pattern = /require\(([^)]+)\)/g
        let functionTextwoComments = strip(functionText);
        let result = pattern.exec(functionTextwoComments);
        let requiredModules = []
        
        while(result != null){
            //get module name and replace quotes if any            
            let moduleFullName = result[1]
            .replace(/'/g,"")
            .replace(/"/g,"");
            let matched = moduleFullName.charAt(0) === "@" ? moduleFullName.match(RE_SCOPED) : moduleFullName.match(RE_NORMAL);
            let moduleNameOnly = matched[1];
            let modulePath = matched[2] || '';
            let moduleVersion = matched[3] || '';
            requiredModules.push({
                name: moduleNameOnly, 
                path: modulePath, 
                version: moduleVersion, 
                fullName: moduleFullName
            });
            result = pattern.exec(functionTextwoComments);
        }
        return requiredModules;
    }
    const loadModule = function(moduleFullName, dir){
        let promise = new Promise(function(resolve,reject){
            try{
                npmInstallTo(dir, [moduleFullName])
                .then(function(response){
                    var packages = response.packages;
                    resolve(packages[moduleFullName]);
                }).catch(function(err){
                    reject(err);
                });
            }catch(err){
                reject(err);
            }            
        });
        return promise;
    }
    const checkInstallStatus = function(instanceRequiredModules, allModulesList){
        let result = {
            attemptComplete: true,
            installSuccessful: true,
            statusMessage: "",
            errorMessage: ""
        }
        instanceRequiredModules.forEach(function(module){
            if(allModulesList[module.fullName]){
                let mod = allModulesList[module.fullName];
                if(mod.status === ModuleInstallStatus.Installing){
                    result.attemptComplete = false;
                    result.installSuccessful = false;
                    result.statusMessage += "Installing : " + mod.fullName + "\r\n";                    
                }else if(mod.status === ModuleInstallStatus.Installed){
                    result.statusMessage += "Installed : " + mod.fullName + "\r\n"
                }else if(mod.status === ModuleInstallStatus.Error){
                    result.installSuccessful = false;
                    result.statusMessage += "Error : " + mod.fullName + " : " + mod.error + "\r\n"
                    result.errorMessage += "Error : " + mod.fullName + " : " + mod.error + "\r\n"
                }
            }else{
                result.installSuccessful = false;
                result.attemptComplete = false;
                result.statusMessage += "Not Registered : " + module.fullName + "\n";
                result.errorMessage += "Not Registered : " + module.fullName + "\n";  
            }
        });
        return result;
    }
    const requireOverload = function(moduleFullName, allModulesList){                  
        if(allModulesList[moduleFullName] && 
                allModulesList[moduleFullName].requireReference &&
                allModulesList[moduleFullName].requireReference !== null){                
                return (allModulesList[moduleFullName].requireReference);                    
            }else{
                throw "Cannot find module : " + moduleFullName;
            }
    };
    
    /*end function-npm specific code*/    
    /********************************/
        
    
    function sendResults(node,send,_msgid,msgs,cloneFirstMessage) {
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
                            if (msgCount === 0 && cloneFirstMessage !== false) {
                                msgs[m][n] = RED.util.cloneMessage(msgs[m][n]);
                                msg = msgs[m][n];
                            }
                            msg._msgid = _msgid;
                            msgCount++;
                        } else {
                            var type = typeof msg;
                            if (type === 'object') {
                                type = Buffer.isBuffer(msg)?'Buffer':(util.isArray(msg)?'Array':'Date');
                            }
                            node.error(RED._("function.error.non-message-returned",{ type: type }));
                        }
                    }
                }
            }
        }
        if (msgCount>0) {
            send(msgs);
        }
    }
    function FunctionNpmNode(n) {  //Name Change
        RED.nodes.createNode(this,n);
        var node = this;
        node.name = n.name;
        node.func = n.func;
        var handleNodeDoneCall = true;
        // Check to see if the Function appears to call `node.done()`. If so,
        // we will assume it is well written and does actually call node.done().
        // Otherwise, we will call node.done() after the function returns regardless.
        if (/node\.done\s*\(\s*\)/.test(node.func)) {
            handleNodeDoneCall = false;
        }
        var functionText = "var results = null;"+
                           "results = (function(msg,__send__,__done__){ "+
                              "var __msgid__ = msg._msgid;"+
                              "var node = {"+
                                 "id:__node__.id,"+
                                 "name:__node__.name,"+
                                 "log:__node__.log,"+
                                 "error:__node__.error,"+
                                 "warn:__node__.warn,"+
                                 "debug:__node__.debug,"+
                                 "trace:__node__.trace,"+
                                 "on:__node__.on,"+
                                 "status:__node__.status,"+
                                 "send:function(msgs,cloneMsg){ __node__.send(__send__,__msgid__,msgs,cloneMsg);},"+
                                 "done:__done__"+
                              "};\n"+
                              node.func+"\n"+
                           "})(msg,send,done);";
        node.topic = n.topic;
        node.outstandingTimers = [];
        node.outstandingIntervals = [];
        var sandbox = {
            console:console,
            util:util,
            Buffer:Buffer,
            Date: Date,
            RED: {
                util: RED.util
            },
            __node__: {
                id: node.id,
                name: node.name,
                log: function() {
                    node.log.apply(node, arguments);
                },
                error: function() {
                    node.error.apply(node, arguments);
                },
                warn: function() {
                    node.warn.apply(node, arguments);
                },
                debug: function() {
                    node.debug.apply(node, arguments);
                },
                trace: function() {
                    node.trace.apply(node, arguments);
                },
                send: function(send, id, msgs, cloneMsg) {
                    sendResults(node, send, id, msgs, cloneMsg);
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
            env: {
                get: function(envVar) {
                    var flow = node._flow;
                    return flow.getSetting(envVar);
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
                    sandbox.setTimeout(function(){ resolve(value); }, after);
                });
            };
        }

        /*start function-npm specific code*/    
        /**********************************/
        let downloadComplete = false;
        let downloadError = false;
        let instanceRequiredModules;
        
        try{
            //get the required modules by parsing the function text
            instanceRequiredModules = getRequiredModules(functionText);
            
            //set the node status to installing
            node.status({fill:"blue",shape:"dot",text:"installing"});                
            
            instanceRequiredModules.forEach(function(module){
                registerAndLoadModule(module, allInstancesRequiredModules);                
            });

            //function to check install status and update node status
            const checkInstallStatusAndUpdateStatusMessage = function(){                
                let result = checkInstallStatus(instanceRequiredModules, allInstancesRequiredModules);
                if(result.attemptComplete){
                    if(result.installSuccessful){
                        node.status({fill:"green",shape:"dot",text:"ready"});
                        downloadComplete = true;
                    }else{
                        node.error(result.errorMessage);
                        node.status({fill:"red",shape:"dot",text: result.errorMessage});
                        downloadError = true;
                    }
                }else{
                    //node.status({fill:"blue",shape:"dot",text:result.statusMessage});
                    setTimeout(checkInstallStatusAndUpdateStatusMessage, 1000);
                }
            }

            checkInstallStatusAndUpdateStatusMessage();
            
            sandbox.require = function(moduleFullName){
                return requireOverload(moduleFullName, allInstancesRequiredModules);
            }
        }catch(err){
            //set error bit and send error to the log and set status            
            downloadError = true;
            node.error(err);            
            node.status({fill:"red",shape:"dot",text: err.message});            
        }
        /*end function-npm specific code*/    
        /********************************/
            
        
        var context = vm.createContext(sandbox);
        try {
            node.script = vm.createScript(functionText, {
                filename: 'Function node:'+node.id+(node.name?' ['+node.name+']':''), // filename for stack traces
                displayErrors: true
                // Using the following options causes node 4/6 to not include the line number
                // in the stack output. So don't use them.
                // lineOffset: -11, // line number offset to be used for stack traces
                // columnOffset: 0, // column number offset to be used for stack traces
            });
            
            
            /*start function-npm specific code*/    
            /**********************************/        
            node.on("input", function(msg, send, done){         
                const checkStatusAndInvokeEventHandler = function(){
                    if(downloadComplete){
                        inputEventHandler(msg,send,done);                        
                    }else if(downloadError){
                        node.error("Error downloading module, not executing function");
                    }else{
                        setTimeout(checkStatusAndInvokeEventHandler, 1000);
                    }
                }

                checkStatusAndInvokeEventHandler();
            });
            
            /*end function-npm specific code*/    
            /********************************/
            
            //function-npm edit to line below added a name for the function
            var inputEventHandler = function(msg,send,done) {                
                try {
                    var start = process.hrtime();
                    context.msg = msg;
                    context.send = send;
                    context.done = done;

                    node.script.runInContext(context);
                    sendResults(this,send,msg._msgid,context.results,false);
                    if (handleNodeDoneCall) {
                        done();
                    }

                    var duration = process.hrtime(start);
                    var converted = Math.floor((duration[0] * 1e9 + duration[1])/10000)/100;
                    node.metric("duration", msg, converted);
                    if (process.env.NODE_RED_FUNCTION_TIME) {
                        node.status({fill:"yellow",shape:"dot",text:""+converted});
                    }
                } catch(err) {
                    if ((typeof err === "object") && err.hasOwnProperty("stack")) {
                        //remove unwanted part
                        var index = err.stack.search(/\n\s*at ContextifyScript.Script.runInContext/);
                        err.stack = err.stack.slice(0, index).split('\n').slice(0,-1).join('\n');
                        var stack = err.stack.split(/\r?\n/);

                        //store the error in msg to be used in flows
                        msg.error = err;

                        var line = 0;
                        var errorMessage;
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
                        done(errorMessage);
                    }
                    else if (typeof err === "string") {
                        done(err);
                    }
                    else {
                        done(JSON.stringify(err));
                    }
                }
            };
            node.on("close", function() {
                while (node.outstandingTimers.length > 0) {
                    clearTimeout(node.outstandingTimers.pop());
                }
                while (node.outstandingIntervals.length > 0) {
                    clearInterval(node.outstandingIntervals.pop());
                }
                node.status({});
            });
        } catch(err) {
            // eg SyntaxError - which v8 doesn't include line number information
            // so we can't do better than this
            node.error(err);
        }
    }
    RED.nodes.registerType("function-npm",FunctionNpmNode);
    RED.library.register("functions");
};