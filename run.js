const {Builder, By, Key, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');
const {BloomFilter} = require('bloomfilter');
const url = require('url');
const querystring = require('querystring');
const mv = require('mv');
const process = require('process');

const cfg = require('./config.json');

const timeLoadTid = 30000;
const timeLoadGid = 10000;

let record = './page.json';

let lastItem = '';

async function login(driver) {
    await driver.findElement(By.name('username')).clear();
    await driver.findElement(By.name('username')).sendKeys(cfg.user);
    await driver.findElement(By.name('password')).clear();
    await driver.findElement(By.name('password')).sendKeys(cfg.password);
}

async function loginVerify(driver,verifyCode) {
    await driver.findElement(By.name('seccodeverify')).clear();
    await driver.findElement(By.name('seccodeverify')).sendKeys(verifyCode);

    await driver.findElement(By.className('pn')).click();
}

async function getTodayTotal() {
    let workPath = './download/';
    let result = fs.readdirSync(workPath);
    let today = new Date;
    let total = { unknown:0 };
    for (let i = 0; i < result.length; i++) {
        let s = fs.statSync(workPath+result[i]);
        if(s.birthtime.getFullYear() === today.getFullYear()
            && s.birthtime.getMonth() === today.getMonth()
            && s.birthtime.getDate() === today.getDate()){
                let elements = result[i].split('+');
                if(elements.length > 1){
                    if(!total.hasOwnProperty(elements[0])) {
                        total[elements[0]] = 0;
                    }
                    total[elements[0]]++;
                } else {
                    total['unknown']++;
                }
            }
    }
    console.log('today: '+today.toLocaleString());
    let keys = Object.keys(total);
    for(let i = 0; i < keys.length; i++){
        console.log(`${keys[i]}\t${total[keys[i]]}`)
    }
    return total;
}

async function refresh(g_) {
    checkBloom(g_);

    g_['count'] = {};

    let dirs = ['download'];

    for (let i = 0; i < dirs.length; i++) {
        let result = fs.readdirSync('./'+dirs[i]);
        for (let j = 0; j < result.length; j++) {
            updateBloom(g_,result[j]);
        }
        console.log(`load ${result.length} ${dirs[i]} files`);
    }

    const data = fs.readFileSync('../archive.txt', 'UTF-8');
    const lines = data.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        updateBloom(g_,lines[i]);
    }
    console.log(`load ${lines.length} archive files`);

    // add invalid record
    let exists = Object.keys(g_['count']);
    for(let i = 0; i < exists.length; i++){
        g_['count'][exists[i]] += getRecordInvalidLength(g_,exists[i]);
    }
}

async function initPage(driver,g_,urlStr) {
    await driver.get(urlStr);
    let nav = await driver.findElement(By.css('.z>a:nth-child(5)'));
    let navHref = await nav.getAttribute('href');
    let navUrl = url.parse(navHref);
    let navObj = querystring.parse(navUrl.query);
    if (typeof navObj.fid !== undefined) {
        if (!g_.hasOwnProperty('record')) {
            g_['record'] = {};
        }
        setRecordLast(g_,navObj['fid'],urlStr);
    }
    console.log(g_);
}

async function savePage(g_,filepath) {
    let pageData = JSON.stringify(g_['record']);
    fs.writeFileSync(filepath,pageData);
}

async function getNavFid(driver) {
    let nav = await driver.findElement(By.css('.z>a:nth-child(5)'));
    let navHref = await nav.getAttribute('href');
    let navUrl = url.parse(navHref);
    let navObj = querystring.parse(navUrl.query);
    if(navObj.fid == cfg.fidHistory){
        nav = await driver.findElement(By.css('.z>a:nth-child(7)'));
        navHref = await nav.getAttribute('href');
        navUrl = url.parse(navHref);
        navObj = querystring.parse(navUrl.query);
    }
    return navObj.fid;
}

async function getCurrentTid(driver) {
    let currUrl = url.parse(await driver.getCurrentUrl());
    let currQuery = querystring.parse(currUrl.query);
    return currQuery.tid;
}

async function tryMagnet(driver) {
    let result = '';
    try{
        let elem = await driver.findElement(By.css('.blockcode li'));
        let magnet = await elem.getText();
        if(magnet.length > 0){
            result = magnet;
        }
    }catch(e){
    }
    return result;
}

// return true(ok), false(no more), null(download timeout)
async function getAttachment(driver,g_,fid_,isGoToNext) {
    let attachment;
    let name;

    // find 500 try to refresh
    if (await isError500(driver) === true) {
        console.log('http error 500');
        await driver.navigate().refresh();
    }

    if (await checkNoMore(driver) === true) {
        return false;
    }

    let fid = await getNavFid(driver);
    let tid = await getCurrentTid(driver);
    if(fid === cfg.fidAnnouncement){
        setRecordInvalid(g_,fid_,tid);
        console.log('skip Forum Announcement '+tid);
        return false;
    }

    try {
        attachment = await driver.findElement(By.css('.attnm>a'));
        name = await attachment.getText();
        lastItem = await driver.getCurrentUrl();
    }catch(e) {
        try{
            attachment = await driver.findElement(By.css('.t_f>span>a'));
            name = await attachment.getText();
            lastItem = await driver.getCurrentUrl();
        }catch(e2){
            let info = await tryMagnet(driver);
            console.log('false\t'+fid+'\t'+tid+'\tcannot find attachment\t'+info);

		// skip temporarily
		//setRecordInvalid(g_,fid_,tid);

            await driver.sleep(900);
            if (isGoToNext === true){
                await customPageLoad(driver,timeLoadTid,async(dri)=>{
                    await dri.findElement(By.css('.modmenu>td>a:last-child')).click();
                });
            }
            return true;
        }
    }

    let exist = testBloom(g_,getTargetName(fid,tid,name));
    console.log(exist+'\t'+fid+'\t'+tid+'\t'+name);

    if (fid !== fid_) {
        console.log('fid error',fid,fid_);
        return false;
    }

    // check download history
    if (exist === false) {
        await attachment.click();
        let times = 0;
        for (let listWindow = await driver.getAllWindowHandles();
                listWindow.length > 1;
                listWindow = await driver.getAllWindowHandles()) {
            try{
                await driver.switchTo().window(listWindow[1]);
                if (await checkDaily(driver) === true) {
                    await driver.close();
                    //await driver.switchTo().window(listWindow[0]);
                    return false;
                }
                if (fs.existsSync(cfg.downloadPath+name)) {
                    await driver.close();
                    break;
                }
            }finally{
                await driver.switchTo().window(listWindow[0]);
            }

            await driver.sleep(500);
            times += 500;

            if (times >= 20000) {
                // await driver.switchTo().window(listWindow[1]);
                // if (await checkDaily(driver) === true) {
                //     await driver.close();
                //     await driver.switchTo().window(listWindow[0]);
                //     return false
                // }
                // await driver.switchTo().window(listWindow[0]);
                return null;
            }
        }
        await mvDownload(driver,fid,tid,name,g_);
    }

    await driver.sleep(300);
    if (isGoToNext === true){
        await customPageLoad(driver,timeLoadTid,async(dri)=>{
            await dri.findElement(By.css('.modmenu>td>a:last-child')).click();
        });
    }
    return true;
}

async function customPageLoad(driver,timeTimeout,funcAction) {
    let timeouts = await driver.manage().getTimeouts();
    let old = timeouts.pageLoad;
    timeouts.pageLoad = timeTimeout;
    await driver.manage().setTimeouts(timeouts);
    try{
        await funcAction(driver);
    }catch(e){
        if (e.name !== 'TimeoutError') {
            throw e;
        }
    }finally{
        timeouts.pageLoad = old;
        await driver.manage().setTimeouts(timeouts);
    }
}

function testBloom(g_,targetName) {
    if (!g_.hasOwnProperty('bloom')) {
        return false;
    }
    // get fid+tid
    let equal = targetName.indexOf('=');
    if (equal !== -1) {
        let fidTid = targetName.substr(0,equal);
        if (fidTid.length > 0) {
            targetName = fidTid;
        }
    }
    return g_['bloom'].test(targetName);
}

function checkBloom(g_) {
    if (!g_.hasOwnProperty('bloom')) {
        g_['bloom'] = new BloomFilter(1024*4096,64);
    }
}

// filtered with fid+tid
function updateBloom(g_,targetName) {
    checkBloom(g_);
    // get fid+tid
    let equal = targetName.indexOf('=');
    if (equal !== -1) {
        let fidTid = targetName.substr(0,equal);
        if (fidTid.length > 0) {
            targetName = fidTid;
        }
    }
    g_['bloom'].add(targetName);
    let plus = targetName.indexOf('+');
    if (plus !== -1) {
        let prefix = targetName.substr(0,plus);
        if (prefix.length > 0) {
            if (!g_['count'].hasOwnProperty(prefix)) {
                g_['count'][prefix] = 0;
            }
            g_['count'][prefix]++;
        }
    }
}

async function recordPage(g_,fid) {
    if (lastItem.length === 0) {
        console.log('not valid update');
        return false;
    }
    if (lastItem === getRecordLast(g_,fid)) {
        console.log('not need update');
        return false;
    }
    console.log(fid+' update '+getRecordLast(g_,fid)+' to '+lastItem);
    setRecordLast(g_,fid,lastItem);
    return true;
}

async function loadPage(g_,filename) {
    let content = fs.readFileSync(filename);
    g_['record'] = JSON.parse(content);
}

function mvSync(src,dst) {
    return new Promise((res,rej)=>{
        mv(src,dst,(err)=>{
            if (err === null) {
                return res();
            }
            return rej();
        });
    });
}

function getTargetName(fid,tid,name) {
    return fid+'+'+tid+'='+name;
}

async function mvDownload(driver,fid,tid,name,g_) {
    if (!fs.existsSync(__dirname+'/download')) {
        fs.mkdirSync(__dirname+'/download');
    }
    let downloads;

    // wait download
    for(let i = 0; i < 20; i++) {
        downloads = fs.readdirSync(cfg.downloadPath);
        if (downloads.length !== 1) {
            console.log(downloads);
            throw 'download directory file error';
        }
        if (downloads[0].indexOf('.crdownload') === -1 && downloads[0].indexOf('.tmp') === -1) {
            // check size
            targetStat = fs.statSync(cfg.downloadPath+downloads[0]);
            if (targetStat['size'] > 0) {
                break;
            }
        }
        await driver.sleep(500);
    }
    if (downloads[0] !== name) {
        if (downloads[0].toLowerCase() !== name.toLowerCase()) {
            let convert = downloads[0].replace('_','~');
            if (convert.toLowerCase() !== name.toLowerCase()) {
                throw 'attatchment name('+name+') not match download file name('+downloads[0]+')';
            }
        }
    }

    let targetName = getTargetName(fid,tid,name);

    try{
        await mvSync(cfg.downloadPath+downloads[0],__dirname+'/download/'+targetName);
    }catch(e){
        // unknown error, check file mv correctly
        if (!fs.existsSync(__dirname+'/download/'+targetName)) {
            throw e;
        }
    }
    updateBloom(g_,targetName);
}

async function isDownloadDirEmpty() {
    let downloads = fs.readdirSync(cfg.downloadPath);
    if (downloads.length > 0) {
        return false;
    }
    return true;
}

async function checkDaily(driver) {
    let title;
    try{
        title = await driver.getTitle();
    }catch(e){
        return false;
    }
    if (title !== null && title.indexOf('提示信息') === 0) {
        try {
            let msg = await driver.findElement(By.css('#messagetext>p:first-child'));
            let msgText = await msg.getText();
            if (msgText.indexOf('您每日可下載附件總計') === 0) {
                return true;
            }
            return false;
        }catch(e) {
            return false
        }
    }
    return false;
}

async function checkNoMore(driver) {
    let title = await driver.getTitle();
    if (title.indexOf('提示信息') === 0) {
        try {
            let msg = await driver.findElement(By.css('#messagetext>p:first-child'));
            let msgText = await msg.getText();
            if (msgText.indexOf('沒有比當前更新的主題') === 0) {
                return true;
            }
            return false;
        }catch(e) {
            return false
        }
    }
    return false;
}

async function getCategories(driver,g_) {
    let ret = [];
    g_['total'] = {};
    for(let j = 0; j < cfg.gid.length; j++) {
        await customPageLoad(driver,timeLoadGid,async(dri)=>{
            await dri.get(cfg.home+'forum.php?gid='+cfg.gid[j].toString());
        });

        let items = await driver.findElements(By.css('table.fl_tb tr'));
        for(let i = 0; i < items.length; i++) {
            try{
                let linkUrl = url.parse(await items[i].findElement(By.css('h2>a')).getAttribute('href'));
                let linkObj = querystring.parse(linkUrl.query);
                g_['total'][linkObj.fid] = await items[i].findElement(By.css('span.xi2')).getText();
                ret.push(linkObj.fid);
            }catch(e){}
        }
    }
    
    // init record
    for(let j = 0; j < ret.length; j++) {
        if (ret[j] === cfg.fidHistory){
            continue;
        }
        if (getRecordLast(g_,ret[j]) === '') {
            setRecordLast(g_,ret[j], await getFidLast(driver,ret[j]));
        }
    }
    return ret;
}

async function getLastItem(driver) {
    try{
        let type = await driver.findElement(By.css('#waterfall'));
        let items = await driver.findElements(By.css('li a.z'));
        return await items[items.length-1].getAttribute('href');
    }catch(e){
        let items = await driver.findElements(By.css('tbody[id^=normalthread_] .xst'));
        return await items[items.length-1].getAttribute('href');
    }
}

async function getFidLast(driver,fid) {
    await driver.get(cfg.home+'forum.php?mod=forumdisplay&fid='+fid);
    try{
        let lastPage = await driver.findElement(By.css('#pgt>.pg>a:nth-last-child(2)'));
        await driver.get(await lastPage.getAttribute('href'));
    }catch(e){
        // only 1 page
    }
    return await getLastItem(driver);
}

async function isError500(driver) {
    try{
        let code = await driver.findElement(By.css('div.error-code')).getText();
        if (code === 'HTTP ERROR 500') {
            return true;
        }
    }catch(e){
    }
    return false;
}

async function fidLastPage(driver,fid){
    await driver.get(cfg.home+'forum.php?mod=forumdisplay&fid='+fid);
    try{
       let lastPage = await driver.findElement(By.css('#pgt>.pg>a:nth-last-child(2)'));
       await driver.get(await lastPage.getAttribute('href'));
    }catch(e){
       // only 1 page
    }
}

async function fidLeftCheck(driver,g_,fid) {
    //let now = g_['count'][fid] + getRecordInvalidLength(g_,fid);
    //if (now === parseInt(g_['total'][fid])) {
    //    console.log('not find left');
    //    return;
    //}
    //console.log(now.toString()+'/'+parseInt(g_['total'][fid]));

    let todo = [];
    let objReturn = {page:'0',left:0};
    while(true) {
        let items = await driver.findElements(By.css('tbody[id^=normalthread_] .xst'));
        if (items.length < 1) {
            items = await driver.findElements(By.css('a.z'));
        }
        for(let i = 0; i < items.length; i++) {
            let item = await items[i].getAttribute('href');
            let itemUrl = url.parse(item);
            let itemObj = querystring.parse(itemUrl.query);
            if (testBloom(g_,fid+'+'+itemObj.tid) === false) {
                let invalid = getRecordInvalid(g_,fid);
                if (invalid.length > 0 && invalid.includes(itemObj.tid)) {
                    continue;
                }
                todo.push(item);
            }
        }
	let curr = await driver.getCurrentUrl();
	let currUrl = url.parse(curr);
	let currObj = querystring.parse(currUrl.query);
	let page = parseInt(currObj.page);
        console.log('%O %d/%d %s',todo,todo.length,items.length,page);
        objReturn.page = page;
        if(todo.length === 0) {
            if (page > 1) {
                page--;
                await driver.get(cfg.home+'forum.php?mod=forumdisplay&fid='+fid+'&page='+page.toString());
            }else{
                break;
            }
        }else{
            break;
        }
    }
    let urlRecord = await driver.getCurrentUrl();
    let i = 0;
    for(i = 0; i < todo.length; i++) {
        await driver.get(todo[i]);
        if (await getAttachment(driver,g_,fid,false) !== true) {
            break;
        }
    }
    await driver.get(urlRecord);
    objReturn.left = todo.length-i;
    return objReturn;

    let curr = await driver.getCurrentUrl();
    let currUrl = url.parse(curr);
    let currObj = querystring.parse(currUrl.query);
    let page = parseInt(currObj.page);
    if (page > 1) {
        page--;
        await driver.get(cfg.home+'forum.php?mod=forumdisplay&fid='+fid+'&page='+page.toString());
    }
}

function getRecordLast(g_,fid){
    if(!g_['record'].hasOwnProperty(fid)){
        return '';
    }
    return cfg.home + g_['record'][fid]['last'];
}

function setRecordLast(g_,fid,last){
    if(!g_['record'].hasOwnProperty(fid)){
        g_['record'][fid] = {};
    }
    g_['record'][fid]['last'] = last.substr(last.indexOf('forum.php'));
}

function setRecordInvalid(g_,fid,invalidTid){
    if(!g_['record'].hasOwnProperty(fid)){
        g_['record'][fid] = {};
    }
    if(!g_['record'][fid].hasOwnProperty('invalid')){
        g_['record'][fid]['invalid'] = [];
    }
    for(let i = 0; i < g_['record'][fid]['invalid'].length; i++){
        if(g_['record'][fid]['invalid'][i] === invalidTid){
            return;
        }
    }
    g_['record'][fid]['invalid'].push(invalidTid);
}

function getRecordInvalid(g_,fid){
    if(!g_['record'].hasOwnProperty(fid)){
        return [];
    }
    if(!g_['record'][fid].hasOwnProperty('invalid')){
        return [];
    }
    return g_['record'][fid]['invalid'];
}

function getRecordInvalidLength(g_,fid){
    if(!g_['record'].hasOwnProperty(fid)){
        return 0;
    }
    if(!g_['record'][fid].hasOwnProperty('invalid')){
        return 0;
    }
    return g_['record'][fid]['invalid'].length;
}

async function isSingleTab(driver){
    return (await driver.getAllWindowHandles()).length == 1;
}

async function runAllCatagory(driver,g_){
    let validFid = await getCategories(driver,g_);
    if (validFid.length < 1) {
        console.log('cannot find valid fid');
        return;
    }
	
	console.log(validFid);

    let fidTime = {};
    for (let i = 0; i < validFid.length; i++) {
        if(! await isDownloadDirEmpty()){
            console.log('check download directory');return;
        }
        if(! await isSingleTab(driver)){
            console.log('check tabs');return;
        }
        if (cfg.fidHistory === validFid[i]){
            continue;
        }
        lastItem = '';
        fidTime[validFid[i]] = 0
        let startTime = process.uptime();
        if (g_['count'][validFid[i]] >= parseInt(g_['total'][validFid[i]])) {
            console.log(validFid[i]+' '+g_['total'][validFid[i]]+' no update');
            console.log();
            continue;
        }
        console.log(`begin ${validFid[i]} ${g_['count'][validFid[i]]}/${g_['total'][validFid[i]]} ${i+1}/${validFid.length}`);
        await customPageLoad(driver,timeLoadTid,async(dri)=>{
            await dri.get(getRecordLast(g_,validFid[i]));
        });
        let result = true;
        while (result === true) {
            result = await getAttachment(driver,g_,validFid[i],true);
            if (g_.hasOwnProperty('stop')) {
                if (result === true) {
                    result = false;
                }
                break;
            }
        }
        let fid;
        try {
            fid = await getNavFid(driver);
        }catch(e){
            fid = validFid[i]
        }
        if (await recordPage(g_,fid) === true) {
            await savePage(g_,record);
        }
        if (result === true) {
            console.log('download timeout');
        }
        fidTime[validFid[i]] = process.uptime() - startTime;
        if (g_.hasOwnProperty('stop')) {
            console.log('exit');
            delete g_['stop'];
            break;
        }
        console.log(`end ${validFid[i]} ${g_['count'][validFid[i]]}/${g_['total'][validFid[i]]} ${fidTime[validFid[i]]}`);
        console.log();
    }

    let totalTime = 0.0;
    console.log('status:');
    for (let i = 0; i < validFid.length; i++) {
        try{
            console.log(`\t${validFid[i]}\t${g_['count'][validFid[i]]}\t${g_['total'][validFid[i]]}\t${fidTime[validFid[i]].toFixed(2)}`);
            totalTime += fidTime[validFid[i]];
        }catch(e){}
    }
    console.log();
    console.log('total time: '+totalTime.toFixed(2).toString());

    await getTodayTotal();
}

function responseText(response,content){
    response.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end(content);
}

exports.screenshot = async function(driver,g_,extend,response) {
    let data = new Buffer.from(await driver.takeScreenshot(),'base64');
    response.writeHead(200, {'Content-Type': 'image/png'});
    response.write(data,'binary');
    response.end(null,'binary');
}

exports.screenshotBase64 = async function(driver,g_,extend,response) {
    responseText(response,await driver.takeScreenshot());
}

exports.login = async function(driver,g_,extend,response) {
    await loadPage(g_,record);
    await refresh(g_);
    console.log(g_['record']);
    await driver.get(cfg.home);
    await login(driver);
    responseText(response,'ok');
}

exports.verify = async function(driver,_g,extend,response) {
    await loginVerify(driver,extend);
    responseText(response,'ok');
}

exports.tabs = async function(driver,_g,extend,response) {
    let handles = await driver.getAllWindowHandles();
    let currentHandle = await driver.getWindowHandle();
    let result = [];
    console.log('[');
    for(let i = 0; i < handles.length; i++){
	await driver.switchTo().window(handles[i]);
        let tabInfo = {
            id: handles[i],
            title: await driver.getTitle(),
            isFocus: false
        };
        if(currentHandle === handles[i]){
            tabInfo.isFocus = true;
	}
        result.push(tabInfo);
    }

    await driver.switchTo().window(currentHandle);

    console.log(']');
    responseText(response,JSON.stringify(result));
}

exports.tabDel = async function(driver,_g,extend,response) {
    let handles = await driver.getAllWindowHandles();
    if(!handles.includes(extend)){
        responseText(response,'not found');return;
    }
    if(handles.length === 1){
        responseText(response,'only 1 page');return;
    }
    let switchTo = '';
    for(let i = 0; i < handles.length; i++){
        if(handles[i] !== extend){ switchTo = handles[i]; }
    }
    await driver.switchTo().window(extend);
    await driver.close();
    await driver.switchTo().window(switchTo);
    responseText(response,'ok');
}

exports.daily = async function(driver,_g,extend,response) {
    let dailyTotal = await getTodayTotal();
    responseText(response,JSON.stringify(dailyTotal));
}

async function expandShadowElement(driver,element){
    return await driver.executeScript('return arguments[0].shadowRoot',element);
}

exports.blockImage = async function(driver,g_,extend,response) {
    let currentTab = await driver.getWindowHandle();
    await driver.switchTo().newWindow('tab');
    await driver.get('chrome://settings/content/images');
    let ele1 = await driver.findElement(By.css('settings-ui'));
    let sd1 = await expandShadowElement(driver,ele1);
    let ele2 = await sd1.findElement(By.css('settings-main'));
    let sd2 = await expandShadowElement(driver,ele2);
    let ele3 = await sd2.findElement(By.css('settings-basic-page'));
    let sd3 = await expandShadowElement(driver,ele3);
    let ele4 = await sd3.findElement(By.css('settings-privacy-page'));
    let sd4 = await expandShadowElement(driver,ele4);
    let ele5 = await sd4.findElement(By.css('category-default-setting'));
    let sd5 = await expandShadowElement(driver,ele5);
    let ele6 = await sd5.findElement(By.css('settings-toggle-button'));
    let sd6 = await expandShadowElement(driver,ele6);

    let ele7 = await sd6.findElement(By.id('control'));
    //console.log(await ele7.getAttribute('aria-pressed'));

    await ele7.click();

    await driver.close();
    await driver.switchTo().window(currentTab);
    responseText(response,'ok');
}

exports.run = async function(driver,g_,extend,response) {
    if(! await isDownloadDirEmpty()){
        console.log('check download directory');return;
    }

    if(! await isSingleTab(driver)){
        console.log('check tabs');return;
    }

    runAllCatagory(driver,g_);
    responseText(response,'ok');

    // add invalid
    if(true === false)
    {
        //setRecordInvalid(g_,fid_,tid);
        setRecordInvalid(g_,'75','439168');

        return;
    }

    // test getAttachment
    if(true === false)
    {
        await getAttachment(driver,g_,'75',false);
        return;
    }

	//driver.navigate().refresh();
	//return;

    // today status
    //await getTodayTotal();
    //return;

    // process left
    // 75 166
    /*let leftFid = '41';
    //await fidLastPage(driver,leftFid);
    let objResult = {};
    let lastPage;
    let lastPageLeft;
    do
    {
        objResult = await fidLeftCheck(driver,g_,leftFid);
	if(objResult.page === lastPage && objResult.left === lastPageLeft){
	    console.log('same result %o',objResult);
	    break;
	}else{
	    lastPage = objResult.page;
	    lastPageLeft = objResult.left;
	}
    }
    //while(false);
    while((objResult.page === 1 && objResult.left > 0) || (objResult.page !== 1 && objResult.left === 0));
    //await getTodayTotal();
    return;*/
    
}
