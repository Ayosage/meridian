import config from '@colyseus/tools'
import { MatchRoom } from './rooms/MatchRoom'
import { CatanRoom } from './rooms/CatanRoom'

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define('match', MatchRoom)
    gameServer.define('catan', CatanRoom)
  },
})
