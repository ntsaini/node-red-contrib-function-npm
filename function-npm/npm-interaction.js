module.exports = function FnNpm() {
    "use strict";
    var strip = require('strip-comments');
    var temp = require('temp');
    var npmInstallTo = require('npm-install-to');
    var self = this;    

    //Private Functions
    
    function getTrackedTempDir(){
        temp.track();
        var tempDir = temp.mkdirSync();
        return tempDir + "/node_modules/"
    }

    //Public Functions    
    self.getRequiredModules = function(functionText){        
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
        var requiredModules = []
        
        while(result != null){
            //get module name and replace quotes if any            
            var moduleFullName = result[1]
            .replace(/'/g,"")
            .replace(/"/g,"");
            var matched = moduleFullName.charAt(0) === "@" ? moduleFullName.match(RE_SCOPED) : moduleFullName.match(RE_NORMAL);
            var moduleNameOnly = matched[1];
            var modulePath = matched[2] || '';
            var moduleVersion = matched[3] || '';
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

    self.loadRequiredModules = function(requiredModules){
        moduleList = requiredModules.map(function(x){
            return x.fullName;
        });
        var tempDir = getTrackedTempDir();
        var installedModules;
        npmInstallTo(tempDir, moduleList)
        .then(function(response){
            var packages = response.npmOutput.packages;
            requiredModules.forEach(function(npmModule) {                
                if (packages[npmModule.fullName]) {                
                    installedModules[npmModule.fullName] = require(packages[npmModule.fullName]);                    
                }
            })
            return installedModules;
        })
    }
}