import { ForbiddenError } from 'apollo-server-express'
import { Types } from 'mongoose'

import {
  Group,
  Media,
  MediaKey,
  MutationGroup_JoinByIdArgs,
  MutationGroup_LeaveByIdArgs,
  User,
} from '~/types/api.generated'
import { TDocument, TResolve } from '~/types/db'
import { schemaComposer } from '~/utils/graphql'
import { dbSchemaFactory } from '~/utils/schema'

import media from './media'
import user from './user'

const group = dbSchemaFactory<Group>(
  'group',
  {
    membersId: {
      default: [],
      type: [{ ref: user.name, type: Types.ObjectId }],
    },
    name: { required: true, type: String },
    ownerId: { ref: user.name, required: true, type: Types.ObjectId },
  },
  { compose: { inputType: { removeFields: ['_id'] } } }
)

group.tc.addRelation('owner', {
  prepareArgs: {
    _id: (source) => source.ownerId,
  },
  projection: { ownerId: 1 },
  resolver: () => user.tc.mongooseResolvers.dataLoader(),
})

group.tc.addRelation('members', {
  prepareArgs: {
    _ids: (source) => source.membersId,
  },
  projection: { membersId: 1 },
  resolver: () => user.tc.mongooseResolvers.dataLoaderMany(),
})

const matchTC = schemaComposer.createObjectTC({
  fields: {
    count: 'Int',
    media: media.tc.getTypeNonNull(),
  },
  name: 'match',
})

group.tc.addRelation('matches', {
  projection: { membersId: 1 },
  resolve: async (dbGroup) => {
    const members = (await user.tc.mongooseResolvers
      .findByIds()
      .resolve({ args: { _ids: dbGroup.membersId } })) as TDocument<User>[]

    const votes = members.flatMap((member) => member.votes)

    const matches = votes
      .filter((vote) => vote.like)
      .reduce((mapping, vote) => {
        const key = JSON.stringify(vote.mediaId)

        if (mapping[key] == null) mapping[key] = 1
        else mapping[key] += 1

        return mapping
      }, {} as Record<string, number>)

    const result = Object.entries(matches)
      .map(([mediaString, count]) => ({ count, mediaString }))
      .filter(({ count }) => count > 1)
      .map(async ({ count, mediaString }) => ({
        count,
        media: (await media.getResolver('queries', 'findById').resolve({
          args: { media: JSON.parse(mediaString) as MediaKey },
        })) as Media,
      }))

    return Promise.all(result)
  },
  type: matchTC.getTypeNonNull().getTypePlural().getTypeNonNull(),
})

group.addFields('queries', {
  findById: group.tc.mongooseResolvers.findById(),
})

group.addFields('mutations', {
  createOne: group.tc.mongooseResolvers
    .createOne({ record: { removeFields: ['ownerId'] } })
    .wrapResolve((next) => (rp) => {
      rp.beforeRecordMutate = (doc: TDocument<Group>) => {
        const {
          context: { userId },
        } = rp

        if (doc == null) return

        const dbUserId = Types.ObjectId(userId)

        doc.ownerId = dbUserId
        doc.membersId = [dbUserId]

        return doc
      }

      return next(rp) as TResolve<Group>
    }),
  joinById: group.tc.mongooseResolvers
    .updateById()
    .wrap((resolver) => {
      resolver.removeArg('record')
      return resolver
    })
    .wrapResolve<
      undefined,
      MutationGroup_JoinByIdArgs & { record: Partial<Group> }
    >((next) => async (rp) => {
      rp.args.record = {}

      rp.beforeRecordMutate = (doc: TDocument<Group>) => {
        const {
          context: { userId },
        } = rp

        if (doc == null) return

        const dbUserId = Types.ObjectId(userId)

        if (!doc.membersId?.includes(doc.ownerId)) doc.ownerId = dbUserId
        if (!doc.membersId?.includes(dbUserId)) doc.membersId?.push(dbUserId)

        return doc
      }

      return next(rp) as TResolve<Group>
    }),
  leaveById: group.tc.mongooseResolvers
    .updateById()
    .wrap((resolver) => {
      resolver.removeArg('record')
      return resolver
    })
    .wrapResolve<
      undefined,
      MutationGroup_LeaveByIdArgs & { record: Partial<Group> }
    >((next) => async (rp) => {
      rp.args.record = {}

      rp.beforeRecordMutate = (doc: TDocument<Group>) => {
        const {
          context: { userId },
        } = rp

        if (doc == null) return

        const dbUserId = Types.ObjectId(userId)

        const index = doc.membersId?.indexOf(dbUserId) ?? -1
        if (index > -1) doc.membersId?.splice(index, 1)

        const nextOwner = doc.membersId?.[0]
        if (doc.ownerId.equals(userId) && nextOwner != null)
          doc.ownerId = nextOwner

        return doc
      }

      return next(rp) as TResolve<Group>
    }),
  updateById: group.tc.mongooseResolvers
    .updateById()
    .wrapResolve((next) => (rp) => {
      rp.beforeRecordMutate = (doc: TDocument<Group>) => {
        const {
          context: { userId },
        } = rp

        if (doc == null) return

        if (doc.ownerId.toHexString() != userId)
          throw new ForbiddenError('you are not the owner of this group!')

        if (!doc.membersId?.includes(doc.ownerId))
          doc.membersId?.push(doc.ownerId)

        return doc
      }

      return next(rp) as TResolve<Group>
    }),
})

//* User relations

function getUserGroups(user: User) {
  const groups = group.tc.mongooseResolvers.findMany().resolve({
    args: {
      filter: {
        _operators: { membersId: { in: user._id } },
      },
    },
  }) as Promise<TDocument<Group>[]>
  return groups
}

user.tc.addRelation('groupsId', {
  projection: { _id: 1 },
  resolve: (dbUser, _args, _context, _info) =>
    getUserGroups(dbUser).then((groups) => groups.map((group) => group._id)),
  type: '[MongoID]!',
})

user.tc.addRelation('groups', {
  projection: { _id: 1 },
  resolve: getUserGroups,
  type: group.tc.getTypePlural().getTypeNonNull(),
})

export default group
