import LotusBot from './lib/lotusbot';

const lotusbot = new LotusBot();
lotusbot.init().catch((e: Error) => console.log(e));