var should = require("should");
var helper = require("node-red-node-test-helper");
var functionNpmNode = require("../function-npm/function-npm.js");

const nodeTestTimeoutInMs = 60000

helper.init(require.resolve('node-red'));
 
describe('function-npm node tests', function () {
    this.timeout(nodeTestTimeoutInMs);
  
    beforeEach(function (done) {
        helper.startServer(done);
    });
 
    afterEach(function (done) {
        helper.unload().then(function() {
            helper.stopServer(done);
        });
    });

    it('should be loaded', function (done) {

        let functionText = `
        //syntax to install a specific version
        var lowerCase = require('lower-case')

        msg.payload = {} ;
        
        return msg;
        `
        let flow = [
            {
                "id":"n1",
                "type":"function-npm",
                "name":"test-function-npm",
                "func": functionText            
            }];

        helper.load(functionNpmNode, flow, function () {
            let n1 = helper.getNode("n1");
            let installing = false;
            let statusCheckHandler = function(call){
                if(!installing){
                    call.should.be.calledWith({fill:"blue",shape:"dot",text:"installing"});
                    installing = true
                }else {
                    call.should.be.calledWith({fill:"green",shape:"dot",text:"ready"});                                        
                    n1.removeListener('call:status',statusCheckHandler);
                    done();
                }
            }
            n1.on('call:status', statusCheckHandler);      
        });
    });

    it('should load and resolve latest requires', function (done) {

        let functionText = `
        var { lowerCase } = require('lower-case');

        msg.payload = {             
           lower: lowerCase('Hello World'),
        } ;
        
        return msg;
        `
        testLoadAndResolve(functionText,done, ['lower']);        
    });

    it('should load and resolve version specific requires', function (done) {

        let functionText = `
        var lowerCase = require('lower-case@1.1.3');

        msg.payload = {             
           lower: lowerCase('Hello World'),
        } ;
        
        return msg;        
        `
        testLoadAndResolve(functionText, done, ['lower']);
    });

    it('should load and resolve requires with module name starting with @', function (done) {

        let functionText = `
        var signalr = require('@aspnet/signalr');

        msg.payload = {             
           signalr: signalr.LogLevel.Trace,
        } ;
        
        return msg;        
        `
        testLoadAndResolve(functionText, done, ['signalr']);
    });

    it('should load multiple modules', function (done) {

        let functionText = `
        var lowerCase = require('lower-case@1.1.3');
        var signalr = require('@aspnet/signalr');

        msg.payload = {             
           signalr: signalr.LogLevel.Trace,
           lower: lowerCase('Hello World'),
        } ;
        
        return msg;        
        `
        testLoadAndResolve(functionText, done, ['lower','signalr']);
    });

    it('should catch module load errors and show in status message', function (done) {

        let functionText = `
        var xyz = require('zzhjs&*&@*');

        msg.payload = {             
           xyz: xyz.err,           
        } ;
        
        return msg;        
        `

        let errorText = 'Error : zzhjs&*&@* : Invalid package name "zzhjs&*&": name can only contain URL-friendly characters\r\n'


        let flow = [
            {
                "id":"n1",
                "type":"function-npm",
                "name":"test-function-npm",
                "func": functionText            
            }];

        helper.load(functionNpmNode, flow, function () {
            let n1 = helper.getNode("n1");
            let installing = false;
            let statusCheckHandler = function(call){  
                if(!installing){
                    installing = true
                    call.should.be.calledWith({fill:"blue",shape:"dot",text:"installing"});                    
                }else {
                    call.should.be.calledWithMatch({fill:"red",shape:"dot", text: errorText});                                        
                    n1.removeListener('call:status',statusCheckHandler);
                    done();
                }
            }

            n1.on('call:status', statusCheckHandler);
        });
    });

    it('should catch module load errors and show in node error log', function (done) {

        let functionText = `
        var xyz = require('zzhjs&*&@*');

        msg.payload = {             
           xyz: xyz.err,           
        } ;
        
        return msg;        
        `

        let flow = [
            {
                "id":"n1",
                "type":"function-npm",
                "name":"test-function-npm",
                "func": functionText            
            }];

        helper.load(functionNpmNode, flow, function () {
            let n1 = helper.getNode("n1");
            
            let errorCheckHandler = function(){
                done();               
            }
            n1.on('call:error', errorCheckHandler);
        });
    });

    it('should load multiple instances of node', function (done) {

        let functionText = `
        var getcss = require('get-css');

        msg.payload = {             
           getcss: true,    
        } ;
        
        return msg;    
        `

        let flow = [
            {
                "id":"n1",
                "type":"function-npm",
                "name":"test-function-npm1",
                "func": functionText            
            }, 
            {
                "id":"n2",
                "type":"function-npm",
                "name":"test-function-npm2",
                "func": functionText
            }
        ];
        
        helper.load(functionNpmNode, flow, function () {
            let n1 = helper.getNode("n1");            
            let n1Installing = false;
            let n1Done = false;
            
            let n2 = helper.getNode("n2");
            let n2Installing = false;
            let n2Done = false;
            
            let statusCheckHandler = function(call, id){
                if((id == "n1" && !n1Installing) || (id == "n2" && !n2Installing)){
                    call.should.be.calledWith({fill:"blue",shape:"dot",text:"installing"});
                    n1Installing = (id == "n1") ? true : n1Installing;
                    n2Installing = (id == "n2") ? true : n2Installing;
                }else {
                    call.should.be.calledWith({fill:"green",shape:"dot",text:"ready"});
                    if(id == "n1"){
                        n1.removeListener('call:status',statusCheckHandler);
                        n1Done = true;                    
                    }
                    if(id == "n2"){
                        n2.removeListener('call:status',statusCheckHandler);
                        n2Done = true;                    
                    }
                    if(n1Done && n2Done){
                        done();
                    }
                }
            }

            errorCheckHandler = function(call){
                done(call.args);
            }

            n1.on('call:status', function(call){
                statusCheckHandler(call, "n1");
            });

            n1.on('call:error', errorCheckHandler);

            n2.on('call:status', function(call){
                statusCheckHandler(call, "n2");
            });

            n2.on('call:error', errorCheckHandler);
        });
    });

    let testLoadAndResolve = function(functionText, done, payloadProperties){
        let flow = [
            {
                "id":"n1",
                "type":"function-npm",
                "name":"test-function-npm",
                "func": functionText,
                "wires":[["n2"]]
            },
            { 
                id: "n2", 
                type: "helper" 
            }];

        helper.load(functionNpmNode, flow, function () {
            let n2 = helper.getNode("n2");
            let n1 = helper.getNode("n1");      
            n2.on("input", function (msg) {
                try{
                    if(payloadProperties){
                        payloadProperties.forEach(function(prop){
                            msg.should.have.propertyByPath('payload', prop);
                        })
                    }                                        
                    done();    
                } catch(err){
                    done(err);
                }
            });
            
            let errorCheckHandler = function(call){
                done(call.args);               
            }
            n1.on('call:error', errorCheckHandler);

            n1.receive();
        });        
    }
});
