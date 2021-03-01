const http = require("http");
const Datastore = require('nedb-promises');
const call = new Datastore({ filename: './db/calls', autoload: true });
const _ = require('lodash');

const makePastebinCall = ({ reqNo, salvoNo }) => {

  console.log('makePastebinCall()', 'reqNo', reqNo, 'salvoNo', salvoNo)

  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:8000/pastebin?reqNo=${reqNo}&salvoNo=${salvoNo}`, res => {
      let data = '';

      res.on('data', r => data += r);

      res.on('end', () => {
        //console.log('end', data.toString().substring(0, 30))
        resolve(data);
      });
    });

    req.on('error', e => {
      console.log('error!', e)
      reject(e);
    })
  });
}

const makeStatsCall = ({ salvoNo }) => {
  console.log('makeStatsCall()')
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:8000/stats?salvoNo=${salvoNo}`, res => {
      let data = '';

      res.on('data', r => data += r);

      res.on('end', () => {
        //console.log('makeStatsCall end')
        resolve(data);
      });
    });

    req.on('error', e => {
      console.log('stats error', e)
      reject(e);
    });

  });
}


const makeThisManyCalls = callCount => {
  console.log('calling make50Calls()')

  call.find({}).sort({ salvoNo: -1 }).limit(1).then((docs, err) => {

    let currentMaxSalvoNo;
    if (docs.length == 0) {
      currentMaxSalvoNo = 0;
    } else {
      currentMaxSalvoNo = parseInt(docs[0].salvoNo);
    }
    console.log('docs', docs, 'currentMaxSalvoNo', currentMaxSalvoNo, 'salvoNo', currentMaxSalvoNo+1)

    const promises = _(callCount).times(i => {
      return makePastebinCall({ reqNo: i, salvoNo: currentMaxSalvoNo+1 });
    });

    return Promise.all(promises).then(responses => {
      //console.log('responses', responses)
      return makeStatsCall({ salvoNo: currentMaxSalvoNo+1 });

    }).then(data => {
      console.log('stats data:', data)
    })

  }).catch(e => console.log('e', e));
}


makeThisManyCalls(7);