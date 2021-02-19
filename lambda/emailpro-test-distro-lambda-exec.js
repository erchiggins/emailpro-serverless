const AWS = require('aws-sdk');
const ses = new AWS.SES();

exports.handler = async (event) => {
   
    let message = event.message;
    let recipient = event.recipient;
    
    let boundary = "";
    message.mail.headers.map(header => {
        if (header.name === 'Content-Type') {
            let idx = header.value.indexOf('boundary=') + 10;
            boundary = header.value.substring(idx, header.value.length - 2);
        }
    });
    
    if (boundary === "") {
        console.log('invalid MIME format');
        return;
    }
    
    let data = Buffer.from(message.content, 'base64').toString();
    
    let sections = data.split(`--${boundary}`);
    
    let headers = sections[0];
    
    let header_lines = headers.split('\r\n');
    
    let bcc_set = false;
    
    for (let i=0; i< header_lines.length; i++) {
        if (header_lines[i].substring(0, 4) === 'Bcc:' || 
header_lines[i].substring(0, 3) === 'To:') {
            if (bcc_set) {
                header_lines[i] = '';
            } else {
                header_lines[i] = `Bcc: ${recipient}`;
                bcc_set = true;
            }
        }
    }
    
    header_lines = header_lines.filter(line => line !== '');
    
    header_lines.push('\r\n');
    
    sections[0] = header_lines.join('\r\n');
    
    let params = {
        ConfigurationSetName: 'emailpro-test-distro',
        Destinations: [],
        Source: message.mail.source,
        RawMessage: {
            Data: sections.join(`--${boundary}`)
        },
    };
    
    let send_promise = ses.sendRawEmail(params).promise();
    await send_promise.then(
        function(data){
            console.log(`sent ${message.mail.commonHeaders.subject} to ${recipient}`);
        }).catch(
            function(err) {
                console.log(err, err.stack);
            });  
};

