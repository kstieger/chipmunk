import { CancelablePromise } from 'platform/env/promise';
import { sessions } from '@service/sessions';
import { Logger } from 'platform/log';

import * as Requests from 'platform/ipc/request';

export const handler = Requests.InjectLogger<
    Requests.Stream.Chunk.Request,
    CancelablePromise<Requests.Stream.Chunk.Response>
>(
    (
        log: Logger,
        request: Requests.Stream.Chunk.Request,
    ): CancelablePromise<Requests.Stream.Chunk.Response> => {
        return new CancelablePromise((resolve, reject) => {
            const stored = sessions.get(request.session);
            if (stored === undefined) {
                return reject(new Error(`Session doesn't exist`));
            }
            stored.session
                .getStream()
                .grab(request.from, request.to - request.from + 1)
                .then((rows) => {
                    resolve(
                        new Requests.Stream.Chunk.Response({
                            session: stored.session.getUUID(),
                            from: request.from,
                            to: request.to,
                            rows,
                        }),
                    );
                })
                .catch(reject);
        });
    },
);
