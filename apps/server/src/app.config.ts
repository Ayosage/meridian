import config from '@colyseus/tools'
import { matchMaker } from 'colyseus'
import express from 'express'
import { handleCreateMatch } from './launch'
import { MatchRoom } from './rooms/MatchRoom'
import { CatanRoom } from './rooms/CatanRoom'

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define('match', MatchRoom)
    gameServer.define('catan', CatanRoom)
  },
  initializeExpress: (app) => {
    // Discord-launch endpoint (docs/DISCORD-LAUNCH.md). Refuses everything
    // unless LAUNCH_TOKEN is set and matches.
    app.post('/matches', express.json(), async (req, res) => {
      const result = await handleCreateMatch(req.headers.authorization, req.body, {
        createRoom: (options) => matchMaker.createRoom('catan', options),
        clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
        launchToken: process.env.LAUNCH_TOKEN ?? '',
        now: Date.now,
      })
      res.status(result.status).json(result.body)
    })
  },
})
