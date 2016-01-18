
var fs = require('fs'),
  path = require('path'),
  _ = require('underscore');


// courtesy of natural.WordNet
// TODO link
function lineDataToJSON(line) {
  var data = line.split('| '),
    tokens = data[0].split(/\s+/),
    ptrs = [],
    wCnt = parseInt(tokens[3], 16),
    synonyms = [];

  for(var i = 0; i < wCnt; i++) {
    synonyms.push(tokens[4 + i * 2]);
  }

  var ptrOffset = (wCnt - 1) * 2 + 6;
  for(var i = 0; i < parseInt(tokens[ptrOffset], 10); i++) {
    ptrs.push({
      pointerSymbol: tokens[ptrOffset + 1 + i * 4],
      synsetOffset: parseInt(tokens[ptrOffset + 2 + i * 4], 10),
      pos: tokens[ptrOffset + 3 + i * 4],
      sourceTarget: tokens[ptrOffset + 4 + i * 4]
    });
  }

  // break "gloss" into definition vs. examples
  var glossArray = data[1].split("; ");
  var definition = glossArray[0];
  var examples = glossArray.slice(1);

  for (var k = 0; k < examples.length; k++) {
    examples[k] = examples[k].replace(/\"/g,'').replace(/\s\s+/g,'');
  }

  return {
    synsetOffset: parseInt(tokens[0], 10),
    lexFilenum: parseInt(tokens[1], 10),
    pos: tokens[2],
    wCnt: wCnt,
    lemma: tokens[4],
    synonyms: synonyms,
    lexId: tokens[5],
    ptrs: ptrs,
    gloss: data[1],
    def: definition,
    exp: examples
  };
}


function readLocation(location, callback) {
  //console.log('## read location ', this.fileName, location);

  var
    file = this,
    str = '',
    len = file.nominalLineLength,
    buffer = new Buffer(len);

  readChunk(location, function(err, count) {
    if (err) {
      console.log(err);
      callback(err);
      return;
    }
    //console.log('  read %d bytes at <%d>', count, location);
    //console.log(str);

    callback(null, lineDataToJSON(str));
  });

  function readChunk(pos, cb) {
    fs.read(file.fd, buffer, 0, len, pos, function (err, count) {
      str += buffer.toString('ascii');
      var eol = str.indexOf('\n');

      //console.log('  -- read %d bytes at <%d>', count, pos, eol);

      if (eol === -1 && len < file.maxLineLength) {
        return readChunk(pos + count, cb);
      }

      str = str.substr(0, eol);
      cb(err, count);
    });
  }
}

function lookup(record, callback) {
  var results = [],
    self = this,
    offsets = record.synsetOffset;

  return new Promise(function(resolve, reject) {
    //console.log('data lookup', record);

    offsets
      .map(function (offset) {
        return _.partial(readLocation.bind(self), offset);
      })
      .map(promisifyInto(results))
      .reduce(serialize, openFile())
      .then(done)
      .catch(done);

    function done(lastResult) {
      closeFile();
      //console.log('done promise -- ');
      if (lastResult instanceof Error) {
        callback && callback(lastResult, []);
        reject(lastResult);
      } else {
        callback && callback(null, results);
        resolve(results);
      }
    }
  });

  function serialize(prev, next) {
    return prev.then(next);
  }

  function openFile() {
    if (!self.fd) {
      //console.log(' ... opening', self.filePath);
      self.fd = fs.openSync(self.filePath, 'r');
    }

    // ref count so we know when to close the main index file
    ++self.refcount;
    return Promise.resolve();
  }

  function closeFile() {
    if (--self.refcount === 0) {
      //console.log(' ... closing', self.filePath);
      fs.close(self.fd);
      self.fd = null;
    }
    return Promise.resolve();
  }
}


function promisifyInto(collect) {
  return function(fn) {
    return function() {
      return new Promise(function (resolve, reject) {
        fn(function (error, result) {               // Note callback signature!
          //console.log('cb from get', arguments)
          if (error) {
            reject(error);
          }
          else {
            collect && collect.push(result);
            resolve(result);
          }
        });
      });
    };
  }
}



var DataFile = function(dictPath, name) {
  this.dictPath = dictPath;
  this.fileName = 'data.' + name;
  this.filePath = path.join(this.dictPath, this.fileName);

  this.maxLineLength = DataFile.MAX_LINE_LENGTH[ name ];
  this.nominalLineLength = MAX_SINGLE_READ_LENGTH;
  this.refcount = 0;
};

// maximum read length at a time
var MAX_SINGLE_READ_LENGTH = 512;

//DataFile.prototype.get = get;
DataFile.prototype.lookup = lookup;

// e.g.: wc -L data.adv as of v3.1
DataFile.MAX_LINE_LENGTH = {
  noun: 12972,
  verb: 7713,
  adj: 2794,
  adv: 638
};

module.exports = DataFile;
