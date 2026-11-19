import {
    Injectable
} from '@nestjs/common'

import {
    logJson
} from './logger.js'

import {
    withSpan
} from './tracing.js'

@Injectable()
export class ObserveRepository {
    async load(
        id: string
    ) {
        return withSpan(
            'observe.repo.load',
            async () => {
                logJson(
                    'observe.repo',
                    'repository_lookup',
                    {
                        observe_id:
                            id
                    }
                )

                await new Promise<void>(
                    resolve =>
                        setTimeout(
                            resolve,
                            2
                        )
                )

                return {
                    id
                }
            }
        )
    }
}
