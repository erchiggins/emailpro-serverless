const AWS = require('aws-sdk');
const lambda = new AWS.Lambda({
  region: 'us-east-1'
});
const ses = new AWS.SES();

const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./emailpro_test_client_secret.json');

exports.handler = async (event) => {

    const rawMessage = event.Records[0].Sns.Message;
    const message = JSON.parse(rawMessage);
    const mail = message.mail;
    const sender = mail.source;
    
    if (sender === process.env.valid_sender_0 || sender === 
process.env.valid_sender_1) {
        const recipients = await retrieve_recipients();

        for (let r of recipients){
            var params = {
              FunctionName: "emailpro-test-distro-lambda-exec", 
              InvocationType: "Event", 
              Payload: JSON.stringify({
                    "message": message,
                    "recipient": r
                })
             };
            let exec_promise = lambda.invoke(params).promise();
            await exec_promise.catch(function(err){
                console.log(err, err.stack);
            });
        }
        
        console.log(`sent ${message.mail.commonHeaders.subject} to ${recipients.length} recipients`);

    } else {
        return `unrecognized sender: ${sender}`;
    }
};

async function retrieve_recipients() {
    let recipients = [];
    const doc = new GoogleSpreadsheet(process.env.recipients_sheet_key);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const row_count = parseInt(sheet.rowCount);
    await sheet.loadCells(`B1:B${row_count}`);
    for (let i=1; i<row_count; i++){
        let cell = sheet.getCell(i, 1);
        if (cell.value) {
            recipients.push(cell.value);
        }
    }
    return recipients;
}
