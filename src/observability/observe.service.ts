import {
    Injectable,
    InternalServerErrorException
} from '@nestjs/common'

import {
    logJson
} from './logger.js'

import {
    ObserveRepository
} from './observe.repository.js'

@Injectable()
export class ObserveService {
    constructor(
        private readonly repository:
            ObserveRepository
    ) { }

    async execute(
        id: string
    ) {
        logJson(
            'observe.service',
            'service_execute',
            {
                observe_id:
                    id
            }
        )

        const item =
            await this.repository
                .load(
                    id
                )

        if (
            id.startsWith(
                'fail'
            )
        ) {
            throw new InternalServerErrorException(
                'observability demo failure'
            )
        }

        return item
    }
}
