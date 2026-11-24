import {buildApp} from './scripts/build.mjs';
export default {base:'/yu-study/',publicDir:false,build:{emptyOutDir:true},plugins:[{name:'offline-archive',async closeBundle(){await buildApp(false)}}]};
