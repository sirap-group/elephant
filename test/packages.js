'use strict';

let app     = require('../server');
let request = require('supertest-as-promised').agent(app.listen());
let user    = require('../lib/user');
let co      = require('co');
let url     = require('url');
let crypto  = require('crypto');
let fs      = require('fs');
let s3      = require('../lib/s3');

// make sure this user is in the htpasswd file
const testUser = {name: 'test', password: 'test'};

function bearer (token) {
  return function (request) {
    request.set('Authorization', `Bearer ${token}`);
  };
}

describe('packages', () => {
  let token;

  describe('GET /:package (package metadata)', () => {
    it('returns a package', () => {
      return request.get('/mocha')
      .accept('json')
      .expect(200)
      .then(r => expect(r.body.name).to.eq('mocha'));
    });
  });

  describe('GET /:package/-/:filename (package tarball)', () => {
    before(co.wrap(function* () {
      yield s3.deleteFileAsync('/tarballs/mocha/mocha-1.0.0.tgz');
    }));

    it('returns a package tarball', () => {
      return request.get('/mocha')
      .accept('json')
      .expect(200)
      .then(r => r.body.versions['1.0.0'].dist)
      .then(dist => {
        return new Promise(fulfill => {
          let req = request.get(url.parse(dist.tarball).path);
          let hash = crypto.createHash('sha1');
          hash.setEncoding('hex');
          req.pipe(hash);
          req.on('end', () => {
            hash.end();
            let sha = hash.read();
            expect(sha).to.eq(dist.shasum);
            fulfill();
          });
        });
      });
    });
  });

  describe('PUT /:package (npm publish)', () => {
    before(co.wrap(function* () {
      token = yield user.authenticate(testUser);
      yield s3.deleteFileAsync('/tarballs/elephant-sample/elephant-sample-1.0.0.tgz');
      yield s3.deleteFileAsync('/packages/elephant-sample');
    }));

    it('adds a package', () => {
      return request.put('/mocha')
      .use(bearer(token))
      .send({
        name:         'elephant-sample',
        'dist-tags':  {latest: '1.0.0'},
        versions: {
          '1.0.0': {
            dist: {
              shasum: '13ac99afb9147d64649e62077a192f32b37c846d',
              tarball: 'http://localhost:3000/elephant-sample/-/elephant-sample-1.0.0.tgz',
            }
          }
        },
        _attachments: {
          'elephant-sample-1.0.0.tgz': {
            content_type: 'application/octet-stream',
            data: fs.readFileSync('./test/fixtures/elephant-sample.tar.gz', {encoding: 'base64'})
          }
        }
      })
      .expect(200);
    });
  });
});
