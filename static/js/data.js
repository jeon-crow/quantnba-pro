
// ═══════════════════════════════════════
// DATA LAYER — Static fallback + mutable state
// Updated by API calls at runtime
// ═══════════════════════════════════════

let teams = [
  {abbr:'BOS',name:'Celtics',conf:'east',ortg:122.4,drtg:109.8,pace:97.2,color:'#17B169',_live:false},
  {abbr:'OKC',name:'Thunder',conf:'west',ortg:119.8,drtg:108.6,pace:99.1,color:'#007AC1',_live:false},
  {abbr:'GSW',name:'Warriors',conf:'west',ortg:118.5,drtg:110.2,pace:101.4,color:'#FDB927',_live:false},
  {abbr:'DEN',name:'Nuggets',conf:'west',ortg:117.9,drtg:111.0,pace:96.8,color:'#FEC524',_live:false},
  {abbr:'CLE',name:'Cavaliers',conf:'east',ortg:116.8,drtg:107.4,pace:95.4,color:'#860038',_live:false},
  {abbr:'MIA',name:'Heat',conf:'east',ortg:115.4,drtg:112.1,pace:96.1,color:'#98002E',_live:false},
  {abbr:'PHX',name:'Suns',conf:'west',ortg:114.9,drtg:115.3,pace:102.8,color:'#E56020',_live:false},
  {abbr:'LAL',name:'Lakers',conf:'west',ortg:113.2,drtg:114.6,pace:100.3,color:'#552583',_live:false},
];

let players = [
  {init:'NJ',name:'N. Jokic',team:'DEN',pos:'C',epm:9.2,bpm:11.4,onOff:12.1,color:'#FEC524'},
  {init:'LD',name:'L. Doncic',team:'DAL',pos:'PG',epm:8.1,bpm:9.8,onOff:8.7,color:'#00538C'},
  {init:'GA',name:'G. Antetokounmpo',team:'MIL',pos:'PF',epm:7.8,bpm:9.2,onOff:9.4,color:'#00471B'},
  {init:'JT',name:'J. Tatum',team:'BOS',pos:'SF',epm:7.1,bpm:7.6,onOff:10.2,color:'#17B169'},
  {init:'SC',name:'S. Curry',team:'GSW',pos:'PG',epm:6.9,bpm:8.1,onOff:7.8,color:'#FDB927'},
  {init:'KD',name:'K. Durant',team:'PHX',pos:'SF',epm:5.8,bpm:6.4,onOff:4.1,color:'#E56020'},
];

let injuries = [
  {name:'LeBron James',team:'LAL',status:'GTD',desc:'Ankle soreness',impact:-4.2,_prev:'GTD'},
  {name:'Kevin Durant',team:'PHX',status:'OUT',desc:'Calf strain',impact:-7.8,_prev:'OUT'},
  {name:'Kawhi Leonard',team:'LAC',status:'OUT',desc:'Load mgmt',impact:-6.1,_prev:'OUT'},
  {name:'Ja Morant',team:'MEM',status:'GTD',desc:'Shoulder',impact:-5.3,_prev:'GTD'},
];

let gameData = [
  {
    id:'den-lac', home:'DEN', away:'LAC',
    label:'Nuggets vs Clippers', time:'Today 7:00 PM',
    status:'upcoming', hoursToClose:4.2,
    netRating:{home:6.9, away:1.4},
    recency:{home:[8,12,4,9,11], away:[2,-3,6,4,1]},
    injuries:[
      {name:'K.Leonard',team:'LAC',status:'OUT',epm:5.8},
      {name:'R.Westbrook',team:'LAC',status:'GTD',epm:1.2}
    ],
    homeFlag:1, rest:{home:2, away:0},
    pmPriceMove:+0.04, pmYesPrice:0.58,
    pmVolume:42500, refPaceFast:0, refFoulHigh:0
  },
  {
    id:'dal-nop', home:'DAL', away:'NOP',
    label:'Mavericks vs Pelicans', time:'Today 8:30 PM',
    status:'upcoming', hoursToClose:5.8,
    netRating:{home:5.2, away:0.8},
    recency:{home:[6,10,8,14,9], away:[-1,3,1,4,2]},
    injuries:[{name:'Z.Williams',team:'NOP',status:'OUT',epm:2.1}],
    homeFlag:1, rest:{home:1, away:2},
    pmPriceMove:+0.02, pmYesPrice:0.65,
    pmVolume:38200, refPaceFast:0, refFoulHigh:0
  },
  {
    id:'gsw-phx', home:'GSW', away:'PHX',
    label:'Warriors vs Suns', time:'LIVE - Q4',
    status:'live', hoursToClose:0.3,
    netRating:{home:8.3, away:-0.4},
    recency:{home:[4,9,12,7,11], away:[-5,2,-2,4,1]},
    injuries:[
      {name:'K.Durant',team:'PHX',status:'OUT',epm:7.8},
      {name:'D.Booker',team:'PHX',status:'GTD',epm:5.1}
    ],
    homeFlag:1, rest:{home:2, away:1},
    pmPriceMove:-0.01, pmYesPrice:0.71,
    pmVolume:56700, refPaceFast:1, refFoulHigh:1
  },
  {
    id:'bos-lal', home:'BOS', away:'LAL',
    label:'Celtics vs Lakers', time:'LIVE - Q4',
    status:'live', hoursToClose:0.2,
    netRating:{home:12.6, away:-1.4},
    recency:{home:[10,15,8,12,9], away:[-2,1,3,-1,4]},
    injuries:[{name:'LeBron James',team:'LAL',status:'GTD',epm:5.2}],
    homeFlag:1, rest:{home:2, away:2},
    pmPriceMove:+0.03, pmYesPrice:0.62,
    pmVolume:89300, refPaceFast:0, refFoulHigh:0
  },
  {
    id:'mia-mil', home:'MIA', away:'MIL',
    label:'Heat vs Bucks', time:'LIVE - Q3',
    status:'live', hoursToClose:0.6,
    netRating:{home:3.3, away:6.8},
    recency:{home:[8,5,11,4,9], away:[2,8,6,7,10]},
    injuries:[{name:'D.Robinson',team:'MIA',status:'GTD',epm:1.4}],
    homeFlag:1, rest:{home:1, away:2},
    pmPriceMove:-0.03, pmYesPrice:0.55,
    pmVolume:44100, refPaceFast:1, refFoulHigh:0
  },
  {
    id:'phi-tor', home:'PHI', away:'TOR',
    label:'Sixers vs Raptors', time:'Today 9:00 PM',
    status:'upcoming', hoursToClose:6.2,
    netRating:{home:7.1, away:-3.8},
    recency:{home:[9,12,7,11,8], away:[-4,-1,2,-3,1]},
    injuries:[
      {name:'P.Siakam',team:'TOR',status:'OUT',epm:4.2},
      {name:'O.Anunoby',team:'TOR',status:'OUT',epm:3.8}
    ],
    homeFlag:1, rest:{home:2, away:0},
    pmPriceMove:+0.01, pmYesPrice:0.76,
    pmVolume:31800, refPaceFast:0, refFoulHigh:1
  },
  {
    id:'chi-det', home:'CHI', away:'DET',
    label:'Bulls vs Pistons', time:'Today 8:00 PM',
    status:'upcoming', hoursToClose:5.1,
    netRating:{home:-2.4, away:-5.1},
    recency:{home:[-1,3,-2,1,2], away:[-4,-2,-5,-1,-3]},
    injuries:[],
    homeFlag:1, rest:{home:1, away:2},
    pmPriceMove:-0.02, pmYesPrice:0.62,
    pmVolume:18600, refPaceFast:0, refFoulHigh:0
  },
];

// Polymarket live markets (rebuilt from API or derived)
let liveMarkets = [];

const formData = {
  teams: ['BOS','OKC','GSW','DEN'],
  scores: [
    [8.2, 12.1, 6.4, 15.2, 9.8],
    [14.2, 8.8, 11.4, 9.2, 16.1],
    [4.1, -2.3, 8.8, 11.2, 7.4],
    [2.1, 9.4, 3.2, 8.1, 12.3]
  ],
  colors: ['#17B169','#007AC1','#FDB927','#FEC524']
};

const REF_TEND = {
  'Tony Brothers':  {pace:'Fast', fouls:47.2, tech:.8},
  'Scott Foster':   {pace:'Slow', fouls:41.1, tech:.4},
  'Marc Davis':     {pace:'Med',  fouls:44.6, tech:.6},
  'Ed Malloy':      {pace:'Fast', fouls:46.8, tech:.9},
  'Bill Kennedy':   {pace:'Med',  fouls:43.0, tech:.5},
  'Josh Tiven':     {pace:'Fast', fouls:48.1, tech:1.1},
  'Zach Zarba':     {pace:'Slow', fouls:40.2, tech:.3},
  'James Williams': {pace:'Med',  fouls:43.5, tech:.5},
  'default':        {pace:'Med',  fouls:44.0, tech:.6}
};

// Manual odds storage
let manualOdds = JSON.parse(localStorage.getItem('manualOdds_v2') || '[]');

console.log('✅ data.js loaded (' + teams.length + ' teams, ' + gameData.length + ' games)');
