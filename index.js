const {Builder, By, Key, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const clearModule = require('clear-module');
const fs = require('fs');
const http = require('http');

const cfg = require('./config.json');

let global = {};
let driver;
let run = require('./run.js');

async function requestFunc(request,response) {
    let pathTotal = request.url.split('?');
    let path = pathTotal[0].split('/');
    if(path.length === 1 && path[0].length === 0){
        response.writeHead(200, {'Content-Type': 'text/plain'});
        response.end('index');return;
    }
    switch (path[1]){
        case 'reload': 
        {
            clearModule('./run.js');
            run = require('./run.js');
            //if (typeof run.run === 'function') {
            //    await run.run(driver,global);
            //}
            console.log(Object.keys(run));
            break;
        }
        case 'run':
        {
            if(path[2].length === 0 || !run.hasOwnProperty(path[2])){break;}
            if (typeof run[path[2]] === 'function') {
                let extend = null;
                if(path.length > 3){
                    extend = path[3];
                }
                let result = await run[path[2]](driver,global,extend,response);
                return;
            }
        }
    }
    response.writeHead(404, {'Content-Type': 'text/plain'});response.end('');
}

(async function() {
const options = {
        //profile: {default_content_setting_values: {images: 2}},
        download: {default_directory:cfg.downloadPath}
    };
let test = new chrome.Options();
test.setUserPreferences(options);
test.headless();
// for root user
//test.addArguments('--no-sandbox');
test.windowSize({height:1920,width:1080});
  driver = await new Builder().forBrowser('chrome').setChromeOptions(test).build();
  await driver.setDownloadPath(cfg.downloadPath);
  //driver = await new Builder().withCapabilities(newOptions).forBrowser('chrome').usingServer('http://localhost:9515/').build();
  await driver.get(cfg.index);
  http.createServer(requestFunc).listen(cfg.serverPort);
  console.log('ready');
  //await driver.quit();
})();
