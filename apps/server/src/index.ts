import { listen } from '@colyseus/tools'
import appConfig from './app.config'

const port = Number(process.env.PORT ?? 2567)
void listen(appConfig, port)
