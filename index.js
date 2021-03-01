// index.js

/**
 * Required External Modules
 */
const express = require("express");
const path = require("path");
const https = require("https");
const Datastore = require('nedb-promises');
const moment = require('moment');

/**
 * App Variables
 */
const app = express();
const port = process.env.PORT || "8000";

/* Each row represents a single Pastebin call.
 * Columns:
 *  - _id:       Mongo/nedb primary key
 *  - salvoNo:   The ID of the latest request grouping.
 *  - reqNo:     of the ~50 calls, that call's number. 
 *  - status:    HTTP status
 *  - reqStart:  time in ms of request start
 *  - resFinish: time in ms of response finish
 *  - attemptNo: If repeating a failed call, the repeat-attempt number 
 *  - charCount: If a successful call, character-count in its response
 */
const call = new Datastore({ filename: './db/calls', autoload: true });

/* Keeps track of UTF-8 character distributions per request.
 * Columns
 *  - _id:    primary key
 *  - callId: the ID of the Pastebin call we're analysing.
 *  - char:   the UTF-8 character in question
 *  - freq:   the number of times this character appeared in call=call_id.
 */
const character = new Datastore({ filename: './db/characters', autoload: true });

/* Keeps track of the longest line of each response. Nothing too complex.
 * - _id:           primary key
 * - url:           The URL we're measuring text from. 
 * - longestLength: What it says on the tin.
 */ 
const line = new Datastore({ filename: './db/lines', autoload: true });

/**
 *  App Configuration
 */

const dataSources = [
  'https://pastebin.com/raw/xakN3d90',
  'https://pastebin.com/raw/4aQB0PfA',
  'https://pastebin.com/raw/aqyKgFk4',
  'https://pastebin.com/raw/aqRHtkAN',
  'https://pastebin.com/raw/GwE7q2gR',
  'https://pastebin.com/raw/E9nVzqSU',
  'https://pastebin.com/raw/V895E5bV',
  'https://pastebin.com/raw/hfz8HKBA',
  'https://pastebin.com/raw/EiMfxdb3',
  'https://pastebin.com/raw/QRmckcsw',
  'https://pastеbin.com/raw/z0mcx7dk'
];


const randomSource = () => {
  const i = Math.floor(Math.random() * dataSources.length);
  return dataSources[i];
}


const repeatResponseText = data => {
  const date = new Date();
  const minutes = date.getMinutes();
  let resp = data;
  for (let i=0; i<minutes; i++) resp += data;

  return resp;
}


const calcCharDistsForResponse = ({ data, doc }) => {
  //console.log('calcCharDistsForResponse()', 'doc', doc)

  return new Promise((resolve, reject) => {
    let utf8CharsFreqs = {};

    for (let i=0; i<data.length; i++) { 
      let char = data[i];
      if (utf8CharsFreqs[char] == undefined) utf8CharsFreqs[char] = 1;
      else                                   utf8CharsFreqs[char]++;
    }

    let utf8CharInsertPromises = [];

    for (const[char, freq] of Object.entries(utf8CharsFreqs)) {
      let chars = { callId: doc._id,
                    char,
                    freq }

      utf8CharInsertPromises.push(character.insert(chars));
    }

    Promise.all(utf8CharInsertPromises)
      .then(() => resolve())
      .catch(e => reject(e));
  });
}
  

const handleRepolling = ({ salvoNo, reqNo, attemptNo, reject, reqStart }) => {
  console.log('handleRepolling()', 'salvo', salvoNo, 'req', reqNo, 'attempt', attemptNo)

  const errorCall = { salvoNo: parseInt(salvoNo),
                      reqNo: parseInt(reqNo),
                      status: 400,
                      reqStart,
                      resFinish: moment().valueOf(),
                      attemptNo: parseInt(attemptNo),
                      charCount: 0 }

  call.insert(errorCall).then((err, doc) => {
    if (attemptNo < 10) {
      httpGetToPastebin({ salvoNo, reqNo, attemptNo: attemptNo+1 });
      reject(`salvo ${salvoNo} req ${reqNo} failed, attempting ${attemptNo+1}...`);

    } else {               
      reject("Ten consecutive failed attempts :O");
    }
  });
}

function httpGetToPastebin({ salvoNo, reqNo, attemptNo }) {
  console.log('httpGetToPastebin()', 'salvoNo', salvoNo, 'reqNo', reqNo, 'attemptNo', attemptNo)

  return new Promise((resolve, reject) => {
    let reqStart = moment().valueOf();
    let url = randomSource();

    let req = https.get(url, res => {
      res.setEncoding("utf8");
      let data = "";

      res.on("data", respData => data += respData);

      res.on("end", () => {
        line.find({ url }).then((docs, err) => {
          if (docs.length == 0) {
            let length = 0;
            data.split("\n").forEach(line => {
              if (line.length > length) 
                length = line.length;
            });

            return line.insert({ url, longestLength: length });
          } else {
            return true;
          }

        }).then(() => {
         data = repeatResponseText(data);   

          const endCall = { salvoNo: parseInt(salvoNo),
                            reqNo: parseInt(reqNo), 
                            status: res.statusCode,
                            reqStart,
                            resFinish: moment().valueOf(),
                            attemptNo: parseInt(attemptNo),
                            charCount: data.length };

          return call.insert(endCall);

        }).then((doc, err) => {
          //console.log('inserted endCall, err', err, 'doc', doc)
          return calcCharDistsForResponse({ data, doc }).then(() => {
            resolve({ callId: doc._id, salvoNo });
          });

        }).catch(e => {
          console.log('error', e)
        });
      });
    });

    let timeoutId = setTimeout(() => {
      console.log('Timed out!')
      handleRepolling({ salvoNo, reqNo, attemptNo, reqStart, reject });
    }, 60000);

    req.on('error', e => {
      console.log('Errored!', 'e', e);
      handleRepolling({ salvoNo, reqNo, attemptNo, reqStart, reject });
      clearTimeout(timeoutId);
    });

  }).catch(e => {
    console.log('randomSource() error', e)
  })
}

app.get("/pastebin", (req, res) => {
  console.log('GET /pastebin')

  httpGetToPastebin({ 
    salvoNo: req.query.salvoNo,
    reqNo: req.query.reqNo, 
    attemptNo: 1
  }).then(rt => {
    console.log('inside GET /pastebin, 200 OK', 'salvoNo', req.query.salvoNo, 'reqNo', req.query.reqNo)
    res.status(200).send(rt);
  });
});

app.get('/stats', (req, res) => {
  console.log('GET /stats', 'salvoNo', req.query.salvoNo)

  const salvoNo = req.query.salvoNo;
  let stats = {};

  // avg, max, min:
  call.find({ salvoNo: parseInt(salvoNo) }).then((docs, err) => {

    let maxDuration = 0;
    let minDuration = 999999999;

    let requestDurations = docs.map(call => {
      requestDuration = call.resFinish - call.reqStart;
      if (requestDuration > maxDuration) maxDuration = requestDuration;
      if (requestDuration < minDuration) minDuration = requestDuration;
      return requestDuration;
    });

    let summedDurations = 0;
    requestDurations.forEach(n => summedDurations += n);

    let averageDuration = summedDurations / requestDurations.length;
    stats[`salvo no=${salvoNo}: min call duration`] = minDuration;
    stats[`salvo no=${salvoNo}: max call duration`] = maxDuration;
    stats[`salvo no=${salvoNo}: average call duration`] = averageDuration;


    // Compute retries for this salvo.
    return call.count({ salvoNo, attemptNo: { $gt: 1 }});
  }).then(retriedCallsCount => {
    stats[`salvo no=${salvoNo}: retry count`] = retriedCallsCount;


    // Compute all character count across entire datastore
    return character.find({});
  }).then(docs => {
    let charactersCount = 0;
    docs.forEach(doc => charactersCount += doc.freq);
    stats[`total chars across server lifetime`] = charactersCount;


    // Get longest-line data for all URLs
    return line.find({});
  }).then(lines => {
    lines.forEach(line => {
      stats[`${line.url} longest line`] = line.longestLength;
    });


    // Get char-dist stats for salvo=salvoNo. First, all callIds where salvo=salvoNo;
    // then, all chars and counts for those callIds.
    return call.find({ salvoNo: parseInt(salvoNo) });
  }).then(callsForSalvo => {
    let callIds = callsForSalvo.map(call => call._id);
    console.log('callIds', callIds);

    return character.find({ callId: { $in: callIds }});

  }).then(charDocsForCallIds => {
    console.log('charDocsForCallIds count', charDocsForCallIds.length)
    let charCounts = {};
    charDocsForCallIds.map(charDoc => {
      if (charCounts[charDoc.char] == undefined)
        charCounts[charDoc.char] = parseInt(charDoc.freq);
      else
        charCounts[charDoc.char] += parseInt(charDoc.freq);

      for (const[char, freq] of Object.entries(charCounts))
        stats[`s=${salvoNo} ${char}#"`] = freq;
    });

    res.status(200).send(stats);

  }).catch(e => {
    console.log('/stats error', e)
  });

});


app.listen(port, () => {
  console.log(`Listening to requests on http://localhost:${port}`);
});