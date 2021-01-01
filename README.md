# node-red-contrib-function-npm
Node red function node with capability to install and use packages from npm

## Compatability
node-red version > 1.0

## Install

From your node-red directory
<pre>npm install node-red-contrib-function-npm</pre>

## Usage
The function-npm node behaves like a normal function node, with the exception of allowing the use of npm modules within the script inside the block.
It scans the script for any require statements and downloads the modules specified in the require statements. 
The module is automatically cleaned from the disk when the node-red process closes.
```javascript
//syntax to install a specific version
var lowerCase = require('lower-case@1.1.3')

//if no version specified the latest version is installed
var uc = require('upper-case');

msg.payload = {             
    upper: uc.upperCase('Hello World'),
    lower: lowerCase('Hello World')
} ;
return msg;
```

------

### Project Info

#### URLs
 
 Name          |Link   
---------------|------------------
Github Repo    |<https://github.com/ntsaini/node-red-contrib-function-npm>
NPM Package    |<https://www.npmjs.com/package/node-red-contrib-function-npm>

#### Contributions

If you'd like to contribute to this project, feel invited to commit to this repository!

#### License

This work is licensed under the [Apache License, Version 2.0](LICENSE).

#### Credits

<pre>
Project : node-red-contrib-npm <a href="https://github.com/jthomas/node-red-contrib-npm">(https://github.com/jthomas/node-red-contrib-npm)</a>
License : <a href="https://github.com/jthomas/node-red-contrib-npm/blob/master/LICENSE">MIT License</a>
Author  : James Thomas

For providing the inspiration of the idea and code for installing npm packages dynamically
</pre>

<pre>
Project : node-red <a href="https://github.com/node-red/node-red/blob/master/packages/node_modules/%40node-red/nodes/core/function/10-function.js">(https://github.com/node-red/node-red/blob/master/packages/node_modules/%40node-red/nodes/core/function/10-function.js)</a>
License : <a href="https://github.com/node-red/node-red/blob/master/LICENSE">Apache License 2.0</a>
Author  : Node-RED team

For the base function node code.

</pre>
