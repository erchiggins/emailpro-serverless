const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB();

exports.handler = async(event) => {
    const rawMessage = event.Records[0].Sns.Message;
    const message = JSON.parse(rawMessage);
    const mail = message.mail;
    const sender = mail.source;
    if (sender === process.env.valid_sender_0 || sender === process.env.valid_sender_1) {
        let subject = mail.commonHeaders.subject;
        while (subject.substring(0, 5) === 'Fwd: ') {
            subject = subject.substring(5);
        }
        const rawContent = message.content;
        const content = decode(rawContent);
        console.log(content);
        const item = {
            "timestamp": { S: content.date.timestamp },
            "subject": { S: subject },
            "sender": { S: sender },
            "plaintext": { SS: Array.from(content.plaintext) },
            "markdown": { S: '' + content.markdown }
        };
        const archiveItem = {
            "timestamp": { S: content.date.timestamp },
            "subject": { S: subject },
            "year": { N: content.date.year + '' },
            "month": { N: content.date.month + '' },
            "day": { N: content.date.day + '' }
        };
        const saveparams = {
            TableName: "EmailProMessages",
            Item: item,
            ReturnConsumedCapacity: "TOTAL"
        };
        const saved = await ddb.putItem(saveparams, function(err, data) {
            if (err) {
                console.log(err);
            } else {
                console.log(data);
            }
        }).promise();
        const archiveparams = {
            TableName: "EmailProArchive",
            Item: archiveItem,
            ReturnConsumedCapacity: "TOTAL"
        };
        const savedarchive = await ddb.putItem(archiveparams, function(err, data) {
            if (err) {
                console.log(err);
            } else {
                console.log(data);
            }
        }).promise();
        for (let topic in content.topics) {
            const topicparams = {
                TableName: "EmailProTopics",
                Key: {
                    "topicname": {
                        S: content.topics[topic]
                    }
                },
                UpdateExpression: "ADD emails :attrValue",
                ExpressionAttributeValues: {
                    ":attrValue": { "SS": [subject] }
                },
                ReturnConsumedCapacity: "TOTAL"
            };
            const updatedtopic = await ddb.updateItem(topicparams, function(err, data) {
                if (err) {
                    console.log(err);
                } else {
                    console.log(data);
                }
            }).promise();
        }
    } else {
        return 'unrecognized sender';
    }
};

function decode(content) {
    const payload = Buffer.from(content, 'base64').toString();
    const lines = payload.split("\n");
    let toReturn = {
        date: {
            year: 0,
            month: "",
            day: 0,
            timestamp: ""
        },
        plaintext: new Set(),
        markdown: "",
        topics: []
    };
    let boundary = "";
    let boundaryCount = 0;
    let marks = {
        plainStart: 0, // first line of plaintext section
        markStart: 0, // first line of markdown section
        markEnd: 0 // end of markdown section
    };
    for (let i in lines) {
        lines[i].trim();
        if (lines[i].substring(0, 47) === 'Content-Type: multipart/alternative; boundary="') {
            const end = lines[i].substring(47);
            boundary = '--' + end.substring(0, end.length - 2);
        }
        if (boundary !== "") {
            if (lines[i] === boundary + '\r' || lines[i] === boundary + '--\r') {
                boundaryCount++;
                if (boundaryCount === 1) marks.plainStart = i;
                else if (boundaryCount === 2) marks.markStart = i;
                else if (boundaryCount === 3) marks.markEnd = i;
            }
        }
    }
    // counter for plaintext lines
    let p0 = Number(marks.plainStart) + 8;
    let p1 = Number(marks.markStart);
    // strip out fwd blocks and harvest indivdual words from plaintext body
    for (let p = p0; p < p1; p++) {
        if (lines[p].trim() === '---------- Forwarded message ---------') {
            p += 5;
        } else {
            let textArray = lines[p].trim().split(' ');
            for (let t in textArray) {
                if (textArray[t]) toReturn.plaintext.add(textArray[t]);
            }
        }
    }
    // counter for markdown lines
    let m0 = Number(marks.markStart) + 4;
    let m1 = Number(marks.markEnd);
    let mdString = "";
    for (let m = m0; m < m1; m++) {
        let mdLine = lines[m];
        if (m < m1 - 1 && mdLine.charAt(mdLine.length - 2) === '=') {
            mdLine = mdLine.substring(0, mdLine.length - 2);
        } else {
            mdLine = mdLine.substring(0, mdLine.length - 1);
        }
        mdString += mdLine;
    }
    mdString = parseEncoded(mdString);
    let timesent = "";
    let body = "";
    if (mdString.includes('---------- Forwarded message ---------')) {
        let chunks = mdString.split('---------- Forwarded message ---------');
        let timechunk = chunks[chunks.length - 1];
        const dateIndex = timechunk.indexOf('<br>Date: ');
        const subjIndex = timechunk.indexOf('<br>Subject: ');
        timesent = timechunk.substring(dateIndex + 10, subjIndex);
        const startBody = timechunk.indexOf('<div dir="ltr">');
        body = timechunk.substring(startBody, mdString.length - ((chunks.length - 1) * 6));
    } else {
        timesent = lines[marks.plainStart - 6];
        timesent = timesent.substring(6);
        body = mdString;
    }
    body = body.replace(/topics:*(.+)---/, '');
    toReturn.date = processDate(timesent);
    toReturn.markdown = body;
    // extract topics
    let hitBottomOfTopics = false;
    let topicString = '';
    // step through plaintext lines from bottom to top
    for (let k = parseInt(marks.markStart); k > parseInt(marks.plainStart); k--) {
        let line = lines[k];
        if (!hitBottomOfTopics && line.trim() === '---') {
            // encountered delimiter at end of topic lines
            hitBottomOfTopics = true;
        } else if (hitBottomOfTopics) {
            if (line.substring(0, 8) === 'topics: ') {
                // encountered delimiter at top of topic lines
                topicString = line.substring(8) + topicString;
                break;
            } else {
                // encountered one line of a multiline topics section
                topicString = line + topicString;
            }
        }
    }
    const tlist = topicString.split(',');
    for (let t in tlist) {
        toReturn.topics.push(tlist[t].trim());
    }
    return toReturn;
}


function parseEncoded(toParse) {

    console.log(toParse);
    // standalones
    toParse = toParse.replace(/=([0-7][0-9a-fA-F])/g, (encoded) => {
        return String.fromCodePoint(parseInt(encoded.substring(1), 16));
    });
    // two byte sequences
    toParse = toParse.replace(/=([c-dC-D][0-9a-fA-F])=([8-9a-bA-B][0-9a-fA-F])/g, (encoded) => {
        const bytes = encoded.split('=');
        const binBytes = [];
        bytes.forEach((item) => {
            if (item) {
                binBytes.push(parseInt(item, 16).toString(2));
            }
        });
        // leading byte, in format 110xxxxx
        let binString = binBytes[0].substring(3);
        // second byte, in format 10xxxxxx
        binString += binBytes[1].substring(2);
        return `&#${parseInt(binString, 2).toString()};`;
    });
    // three byte sequences
    toParse = toParse.replace(/=[eE][0-9a-fA-F]=[8-9a-bA-B][0-9a-fA-F]=[8-9a-bA-B][0-9a-fA-F]/g, (encoded) => {
        const bytes = encoded.split('=');
        const binBytes = [];
        bytes.forEach((item) => {
            if (item) {
                binBytes.push(parseInt(item, 16).toString(2));
            }
        });
        // leading byte, in format 1110xxxx
        let binString = binBytes[0].substring(4);
        // second byte, in format 10xxxxxx
        binString += binBytes[1].substring(2);
        // third byte, in format 10xxxxxx
        binString += binBytes[2].substring(2);
        return `&#${parseInt(binString, 2).toString()};`;
    });
    // four byte sequences
    toParse = toParse.replace(/=[fF][0-7]=[8-9a-bA-B][0-9a-fA-F]=[8-9a-bA-B][0-9a-fA-F]=[8-9a-bA-B][0-9a-fA-F]/g, (encoded) => {
        const bytes = encoded.split('=');
        const binBytes = [];
        bytes.forEach((item) => {
            if (item) {
                binBytes.push(parseInt(item, 16).toString(2));
            }
        });
        // leading byte, in format 11110xxx
        let binString = binBytes[0].substring(5);
        // second byte, in format 10xxxxxx
        binString += binBytes[1].substring(2);
        // third byte, in format 10xxxxxx
        binString += binBytes[2].substring(2);
        // fourth byte, in format 10xxxxxx
        binString += binBytes[3].substring(2);
        return `&#${parseInt(binString, 2).toString()};`;
    });
    return toParse;
}


function processDate(timestring) {
    let timetoreturn = {
        year: 0,
        month: 0,
        day: 0,
        timestamp: ""
    }
    timestring = timestring.replace(':', ' ');
    let dateParts = timestring.split(' ');
    let year = parseInt(dateParts[3]);
    const months = {
        'Jan': 0,
        'Feb': 1,
        'Mar': 2,
        'Apr': 3,
        'May': 4,
        'Jun': 5,
        'Jul': 6,
        'Aug': 7,
        'Sep': 8,
        'Oct': 9,
        'Nov': 10,
        'Dec': 11
    };
    // handle day/month inversion for different formats
    let month, day, hour, minute;
    if (dateParts[1] in months) {
        month = months[dateParts[1]];
        timetoreturn.month = months[dateParts[1]];
        day = parseInt(dateParts[2].substring(0, dateParts[2].length - 1));
        hour = parseInt(dateParts[5]) + ((dateParts[7] === 'PM') ? 12 : 0);
        minute = parseInt(dateParts[6]);
    } else {
        month = months[dateParts[2]];
        timetoreturn.month = months[dateParts[2]];
        day = parseInt(dateParts[1]);
        hour = parseInt(dateParts[4]);
        minute = parseInt(dateParts[5].substring(0, 2));
    }
    let date = new Date();
    date.setFullYear(year);
    date.setMonth(month);
    date.setDate(day);
    date.setHours(hour);
    date.setMinutes(minute);
    timetoreturn.timestamp = date.getTime() + "";
    timetoreturn.year = year;
    timetoreturn.day = day;
    return timetoreturn;
}