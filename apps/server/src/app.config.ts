import config from '@colyseus/tools'
import { MatchRoom } from './rooms/MatchRoom'

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define('match', MatchRoom)
  },
})
