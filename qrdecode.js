const jsQR = require('jsqr');
const PNG = require('pngjs').PNG;
const fs = require('fs');
const encoding = require("encoding");
const exec = require('child_process').execFileSync;

let workDir = '../archive/';

function decode(file) {
    return new Promise((resolv, reject) => {
        let imgData = fs.readFileSync(file);
        new PNG({ filterType:4 }).parse(imgData, function(error, data)
        {
            if (error === null) {
                let result = jsQR(data.data, data.width, data.height);
                if (result !== null) {
                    return resolv(result.data.toString().trim());
                }
                return resolv('');
            } else {
                return reject(error);
            }
        });

        // fs.createReadStream(file)
        //     .pipe(new PNG({ filterType: 4 }))
        //     .on('parsed', function () {
        //         return resolv(jsQR(this.data, this.width, this.height).data);
        //     });
    });
}

async function getInfo(file) {
    let cut = file.lastIndexOf('.');
    if (cut === -1) {
        throw 'unknown file type'
    }
    switch (file.substr(cut)) {
        case '.txt': {
            let content = fs.readFileSync(file);
            let find = /解壓密碼：([^\r\n]*)(?:.|[\r\n])*链接[:：\s]+([_0-9a-zA-Z:\/.]*) [\n]?(?:密码|提取码)[：:\s]+([0-9a-zA-Z]+)/g;
            let all = [...content.toString().matchAll(find)];
            if (all.length === 1) {
                return [[all[0][1], all[0][2], all[0][3]]];
            }
            // try 190 match
            {
                find = /(ed2k:[^\r\n]+)/g;
                all = [...content.toString().matchAll(find)];
                console.log(all);
                if (all.length > 0) {
                    ret = [];
                    for(let i = 0; i < all.length; i++) {
                        ret.push(['',all[i][0],''])
                    }
                    return ret;
                }
            }
            throw 'txt match error';
        }
        case '.rar': {
            // exec(`unrar e '${file}'`);
            exec('C:\\Program Files\\7-Zip\\7z',['x',file,'./','*']);
            let allFiles = fs.readdirSync('./');
            let pngfile = /(?<=.*)[0-9a-zA-Z]+(?=[.]png)/g;
            let ret = ['','',''];
            let dirBase = './';
            for (let i = 0; i < allFiles.length; i++) {
                if (allFiles[i] === 'node_modules') {
                    continue;
                }
                if(dirBase === './' && fs.statSync('./'+allFiles[i]).isDirectory() === true){
                    dirBase = './'+allFiles[i]+'/';
                    allFiles = fs.readdirSync(dirBase);
                    i = 0;
                }
                let result = allFiles[i].match(pngfile);
                if (result !== null) {
                    ret[2] = result[0];
                    //console.log('delete ' + allFiles[i]);
                    ret[1] = await decode(dirBase+allFiles[i]);
                    fs.unlinkSync(dirBase+allFiles[i]);
                } else {
                    result = allFiles[i].match('.txt');
                    if (result !== null) {
                        let fileContent = fs.readFileSync(dirBase+allFiles[i]);
                        let pwd = (fileContent.toString().match(/(?<=解壓密碼：)[^\r\n]*/g));
                        if (pwd !== null) {
                            ret[0] = pwd[0];
                        } else {
                            fileContent = encoding.convert(fileContent, 'utf8', 'gbk');
                            pwd = (fileContent.toString().match(/(?<=解壓密碼：)[^\r\n]*/g));
                            if (pwd !== null) {
                                ret[0] = pwd[0];
                            } else {
                                pwd = (fileContent.toString().match(/(magnet:[^\r\n]+)/g));
                                if (pwd !== null) {
                                    ret[1] = pwd[0];
                                }
                            }
                        }
                        //console.log('delete ' + allFiles[i]);
                        fs.unlinkSync(dirBase+allFiles[i]);
                    }

                    result = allFiles[i].match('.srt');
                    if (result !== null) {
                        fs.unlinkSync(dirBase+allFiles[i]);
                    }
                }
            }
            if (dirBase !== './') {
                fs.rmdirSync(dirBase);
            }
            if (ret[1].length > 0) {
                let code = ret[1].split('/');
                if (code[code.length - 1].length < 7) {
                    ret[1] = '';
                }
            }
            return [ret];
        }
        default: throw 'unknown file type';
    }
}

async function processFiles() {
    let files = fs.readdirSync(workDir);
    for (let i = 0; i < files.length; i++) {
        try {
            let data = await getInfo(workDir + files[i]);
            let fid = files[i].split('+');
            for(let j = 0; j < data.length; j++){
                //console.log(fid[0]+'.record',`${files[i]},${data[j][0]},${data[j][1]},${data[j][2]}\n`);
                fs.appendFileSync(fid[0]+'.record',`${files[i]},${data[j][0]},${data[j][1]},${data[j][2]}\n`);
            }
            console.log(`${i+1}/${files.length} ${Math.floor((i+1)/files.length*100)}% ${files[i]}`);
        } catch (e) {
            console.log('err '+files[i]);
            console.log(e);
            throw '123';
        }
    }
}

processFiles();