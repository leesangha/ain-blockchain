const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;
const should = chai.should();
const spawn = require("child_process").spawn;
const PROJECT_ROOT = require('path').dirname(__filename) + "/../" 
const TRACKER_SERVER = PROJECT_ROOT + "server/tracker-server.js"
const APP_SERVER = PROJECT_ROOT + "server/index.js"
const sleep = require('system-sleep');
const expect = chai.expect
chai.use(chaiHttp);
const syncRequest = require('sync-request')
const itParam = require('mocha-param');
const Blockchain = require('../blockchain');
const {BLOCKCHAINS_DIR, METHOD} = require('../config') 
const rimraf = require("rimraf")



// Server configurations
const server1 = 'http://localhost:8080'
const server2 = 'http://localhost:8081'
const server3 = 'http://localhost:8082'
const server4 = 'http://localhost:8083'
const SERVERS = [server1, server2, server3, server4]
const ENV_VARIABLES = [{P2P_PORT:5001, PORT: 8080, LOG: true}, {P2P_PORT:5002, PORT: 8081, LOG: true}, 
                        {P2P_PORT:5003, PORT: 8082, LOG: true}, {P2P_PORT:5004, PORT: 8083, LOG: true}]

// Paths to current Blockchains (These will be needed in order to assure that all db operations are recorded by this test case)
const CHAIN_LOCATION = BLOCKCHAINS_DIR + "/" + "8080"

// Data options
RANDOM_OPERATION = [
  ["set", {ref: "test/comeonnnnnnn", value: "testme"}],
  ["set", {ref: "test/comeonnnnnnn", value: "no meeeee"}],
  ["set", {ref: "test/comeon/nnnnnn", value: "through"}],
  ["set", {ref: "test/comeonnnnnnn/new", value: {"new": "path"}}],
  ["set", {ref: "test/builed/some/deep", value: {"place": {"next":1, "level": "down"}}}],
  ["set", {ref: "test/builed/heliii", value: {"range": [1, 2, 3, 01, 4, 5]}}],
  ["set", {ref: "test/b/u/i/l/e/d/hel", value: {"range": [1, 4, 5], "another": [234]}}],
  ["set", {ref: "test/b/u/i/l/e/d/hel", value: "very nested"}],
  ["set", {ref: "test/b/u/i/l/e/d/hel", value: {1:2,3:4,5:6}}],
  ["set", {ref: "test/new/final/path", value: {"neste": [1, 2, 3, 4, 5]}}],
  ["set", {ref: "test/new/final/path", value: {"more": {"now":12, "hellloooo": 123}}}],
  ["increase", {diff: {"test/increase/first/level": 10, "test/increase/first/level2": 20}}],
  ["increase", {diff: {"test/increase/second/level/deeper": 20, "test/increase/second/level/deeper": 1000}}],
  ["increase", {diff: {"test/increase": 1}}],
  ["increase", {diff: {"test/new":1, "test/b": 30}}],
  ["increase", {diff: {"test/increase": -10000, "test/increase": 10000}}],
  ["increase", {diff: {"test/b/u": 10000}}],
  ["increase", {diff: {"test/builed/some/deep/place/next": 100002}}]
]



describe('Integration Tests', () => {
  let procs = []
  let preTestChainInfo  = {}
  let operationCounter = 0
  let numNewBlocks = 0
  let numBlocks

  before(() => {
    // Start up all servers
    var tracker_proc = spawn('node', [TRACKER_SERVER])
    procs.push(tracker_proc)
    sleep(100)
    for(var i=0; i<ENV_VARIABLES.length; i++){
      var proc = spawn('node', [APP_SERVER], {env: ENV_VARIABLES[i]})
      sleep(1500)
      procs.push(proc)
    };

    var chain = Blockchain.loadChain(CHAIN_LOCATION)
    preTestChainInfo["numBlocks"] = chain.length
    preTestChainInfo["numTransactions"] = chain.reduce((acc, block) => {
        return acc + block.data.length
      }, 0)
      console.log(`Initial block chain is ${preTestChainInfo["numBlocks"]} blocks long containing ${preTestChainInfo["numTransactions"]} database transactions` )
    numBlocks = preTestChainInfo["numBlocks"]

    if(METHOD == "POS"){
      for(var i=0; i<SERVERS.length; i++){
        operationCounter++
        syncRequest("GET", [SERVERS[i], "stake?ref=250"].join("/"))
      }
    }
  })

  after(() => {
    // Teardown all servers
    for(var i=0; i<procs.length; i++){
      procs[i].kill()
    }
    rimraf.sync(BLOCKCHAINS_DIR)
  });

  describe(`blockchain database mining/forging`, () => {
    let random_operation
   
    beforeEach(() => {
      
      for(var i=0; i<30; i++){
          random_operation = RANDOM_OPERATION[Math.floor(Math.random()*RANDOM_OPERATION.length)]
          syncRequest("POST", SERVERS[Math.floor(Math.random() * SERVERS.length)] + "/" + random_operation[0], {json: random_operation[1]})
          operationCounter++
          sleep(100)
      }
    
      if (METHOD == "POW"){
        syncRequest('GET', server3 + '/mine-transactions')
        sleep(100)
      }
      else{
          while(!(JSON.parse(syncRequest('GET', server1 + '/blocks').body.toString("utf-8")).length > numBlocks)){
            sleep(200)
          }
          numBlocks = JSON.parse(syncRequest('GET', server1 + '/blocks').body.toString("utf-8")).length 
      }
      numNewBlocks++
    })

    itParam('syncs accross all peers after mine', SERVERS, (server) => {
      base_db = JSON.parse(syncRequest('GET', server1 + '/get?ref=/').body.toString("utf-8"))
      console.log(base_db)
      return chai.request(server).get(`/get?ref=/`).then((res) => {
              res.should.have.status(200);
              res.body.should.be.deep.eql(base_db)
      })
    })

    it("will sync to new peers on startup", () => {
      const new_server = "http://localhost:8085"
      const new_server_proc = spawn('node', [APP_SERVER], {env: {P2P_PORT:5006, PORT: 8085}})
      sleep(500)
      base_db = JSON.parse(syncRequest('GET', server1 + '/blocks').body.toString("utf-8"))
      return chai.request(new_server).get(`/blocks`).then((res) => {
        new_server_proc.kill()
        res.should.have.status(200);
        res.body.should.be.deep.eql(base_db)
      })
    })

    describe("leads to blockchains", () => {
      let blocks

      beforeEach(() =>{
        blocks = JSON.parse(syncRequest('GET', server2 + '/blocks').body.toString("utf-8"))
      })

      itParam('syncing across all chains', SERVERS, (server) => {
        return chai.request(server).get(`/blocks`).then((res) => {
          res.should.have.status(200);
          res.body.should.be.deep.eql(blocks)
        })
      })

      it('all having correct number of transactions', () => {
        var numTransactions = 0
        blocks.forEach(block => block.data.forEach(_ => {
          numTransactions = numTransactions + 1
        }))
        // Subtract pe chain number of transactions as one is the rule transaction set loaded in initial block 
        expect(operationCounter).to.equal(numTransactions - preTestChainInfo["numTransactions"])
      })

      it('all having correct number of blocks', () => {
        expect(numNewBlocks).to.equal(blocks.length - preTestChainInfo["numBlocks"])
      })
    })

    describe('and rules', ()=> {
      it('prevent users from restructed areas', () => {
        return chai.request(server2).post(`/set`).send( {ref: "restricted/path", value: "anything"}).then((res) => {
          res.should.have.status(401);
        })
      })
    })
  })
})
