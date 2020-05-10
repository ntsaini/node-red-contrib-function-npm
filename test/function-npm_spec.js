var should = require("should");
var helper = require("node-red-node-test-helper");
var functionNpmNode = require("../function-npm/function-npm.js");

const nodefunc = `
    //syntax to install a specific version
    var lowerCase = require('lower-case@1.1.3')
    
    //if no version specified the latest version is installed
    //var upperCase = require('upper-case');
    
    //var signalr = require('@aspnet/signalr');
    //var getcss = require('layoutanalysis/get-css');
    
    msg.payload = {             
       lower: lowerCase('Hello World'),
       //upper: upperCase.upperCase('Hello World')
    } ;
    
    return msg;
    `
const nodeTestTimeoutInMs = 60000

helper.init(require.resolve('node-red'));
 
describe('function-npm Node', function () {
    this.timeout(nodeTestTimeoutInMs);
  
    beforeEach(function (done) {
        helper.startServer(done);
    });
 
    afterEach(function (done) {
        helper.unload().then(function() {
            helper.stopServer(done);
        });
    });

    // //function load test
    // it('should be loaded', function (done) {
    //     var flow = [
    //         {
    //             "id":"n1",
    //             "type":"function-npm",
    //             "name":"test-function-npm",
    //             "func": nodefunc            
    //         }];
    //     helper.load(functionNpmNode, flow, function () {
    //         var n1 = helper.getNode("n1");
    //         var installing = false
    //         n1.on('call:status', function(call){
    //             //console.log(call.args);
    //             if(!installing){
    //                 call.should.be.calledWith({fill:"blue",shape:"dot",text:"installing"});
    //                 installing = true
    //             }else {
    //                 call.should.be.calledWith({fill:"green",shape:"dot",text:"ready"});                                        
    //                 done();                    
    //             }
    //         })      
    //     });
    // });

    //function resolve test
    it('should resolve functions', function (done) {
        var flow = [
            {
                "id":"n1",
                "type":"function-npm",
                "name":"test-function-npm",
                "func": nodefunc,
                "wires":[["n2"]]
            },
            { 
                id: "n2", 
                type: "helper" 
            }];
        helper.load(functionNpmNode, flow, function () {
            var n2 = helper.getNode("n2");
            var n1 = helper.getNode("n1");      
            n2.on("input", function (msg) {
                try{
                    console.log("triggered");
                    console.log(msg);
                    msg.should.have.propertyByPath('payload', 'lower');                    
                    done();    
                } catch(err){
                    done(err);
                }
            });
            n1.receive();
            n1.on('call:status', function(call){
                console.log(call.args);
                if(call.calledWithMatch({text:"ready"})){
                    console.log('calling');                    
                } else if(call.calledWithMatch({fill:"red"})){
                    done("download failed");
                }
            });
        });
    });
});
