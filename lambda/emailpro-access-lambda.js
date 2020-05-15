const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB();

exports.handler = async(event) => {
    let responseStatus = 200;
    let responseBody = "";
    const resource = event.resource;

    if (resource.substring(1, 8) === 'archive') {
        const subject = decodeURI(event.pathParameters.subject);
        responseBody = await retrieveArchive(subject);
    } else if (resource === 'topics') {
        responseBody = await retrieveTopics();
    } else {
        responseStatus = 400;
    }
    if (!responseBody) {
        responseStatus = 400;
    }
    const response = {
        statusCode: responseStatus,
        headers: {
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(responseBody)
    };
    return response;
};

async function retrieveArchive(subject) {
    let toReturn = null;
    if (subject) {
        const params = {
            Key: {
                "subject": {
                    S: subject
                }
            },
            TableName: "EmailProMessages"
        }
        const result = await ddb.getItem(params, function(err, data) {
            if (err) {
                console.log(err);
            } else {
                if (data.Item) {
                    toReturn = {
                        subject: subject,
                        timestamp: data.Item.timestamp.S,
                        markdown: data.Item.markdown.S
                    }
                }
            }
        }).promise();
    } else {
        const params = {
            TableName: "EmailProArchive"
        }
        const result = await ddb.scan(params, function(err, data) {
            if (err) {
                console.log(err);
            } else {
                toReturn = composeArchiveResponse(data);
            }
        }).promise();
    }
    return toReturn;
}

function composeArchiveResponse(data) {
    let archive = {
        years: []
    }
    let currYear, currMonth, yearsFound, monthsFound;
    for (let item of data.Items) {
        yearsFound = archive.years.filter(data => (data.year === parseInt(item.year.N)));
        if (yearsFound.length === 1) {
            // found the item's year in the archive object
            currYear = yearsFound[0];
        } else {
            // need to create new year in the archive object
            currYear = {
                year: parseInt(item.year.N),
                months: []
            };
            archive.years.push(currYear);
        }
        monthsFound = currYear.months.filter(data => (data.month === parseInt(item.month.N)));
        if (monthsFound.length === 1) {
            // found the item's month in the archive object
            currMonth = monthsFound[0];
        } else {
            // need to create new month in the archive object
            currMonth = {
                month: parseInt(item.month.N),
                emails: []
            };
            currYear.months.push(currMonth);
        }
        currMonth.emails.push({
            day: parseInt(item.day.N),
            timestamp: item.timestamp.S,
            subject: item.subject.S,
        });
    }
    // sort by year, month, day
    archive.years = archive.years.sort((y0, y1) => (y0.year > y1.year) ? 1 : -1);
    for (let y of archive.years) {
        for (let m of y.months) {
            m.emails = m.emails.sort((e0, e1) => {
                let compare = (e0.day === e0.day) ? 0 : (e0.day > e1.day) ? 1 : -1;
                if (compare === 0) {
                    compare = (parseInt(e0.timestamp) > parseInt(e1.timestamp)) ? 1 : -1;
                }
                return compare;
            });
        }
        y.months = y.months.sort((m0, m1) => (m0.month > m1.month) ? 1 : -1);
    }
    return archive;
}

async function retrieveTopics() {
    let toReturn = null;
    const params = {
        TableName: "EmailProTopics"
    }
    const result = await ddb.scan(params, function(err, data) {
        if (err) {
            console.log(err);
        } else {
            toReturn = composeTopicsResponse(data);
        }
    }).promise();
    return toReturn;
}

function composeTopicsResponse(data) {
    let topics = [];
    for (let item of data.Items) {
        topics.push({
            name: item.topicname.S,
            emails: item.emails.SS
        });
    }
    topics.sort((t0, t1) => (t0.name > t1.name) ? 1 : -1);
    return topics;
}