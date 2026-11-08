import { Schema } from "effect";

import { nullish } from "~/lib/validators/common";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { listHistory } from "~/server/services/history";

export const historyRouter = createTRPCRouter({
  list: protectedProcedure
    .input(validate(Schema.Struct({ cursor: nullish(Schema.Int) })))
    .query(({ ctx, input, signal }) =>
      runForTrpc(listHistory(ctx.user.id, input.cursor ?? 0), signal),
    ),
});
