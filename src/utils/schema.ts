import { ObjectTypeComposer, Resolver } from 'graphql-compose'
import { composeMongoose, GenerateResolverType } from 'graphql-compose-mongoose'
import mongoose from 'mongoose'

type TDocument<TSchema> = mongoose.Document & TSchema

type IFieldMap = Record<string, Resolver>

interface IFields {
  mutation: IFieldMap
  query: IFieldMap
}

class Schema<
  TSchema extends Record<string, unknown> = Record<string, unknown>
> {
  #fields: IFields = {
    mutation: {},
    query: {},
  }

  schema: mongoose.Schema
  model: mongoose.Model<TDocument<TSchema>>
  tc: ObjectTypeComposer<TDocument<TSchema>, unknown> & {
    mongooseResolvers: GenerateResolverType<TDocument<TSchema>, unknown>
  }

  constructor(
    public name: string,
    definition: mongoose.SchemaDefinition,
    options: mongoose.SchemaOptions = {}
  ) {
    this.name = name
    this.schema = new mongoose.Schema(definition, options)
    this.model = mongoose.model<TDocument<TSchema>>(this.name, this.schema)
    this.tc = composeMongoose<TDocument<TSchema>>(this.model)
  }

  addFields(type: keyof IFields, fields: IFieldMap): void {
    Object.assign(this.#fields[type], fields)
  }

  getFields(type: keyof IFields): IFieldMap {
    return this.#fields[type]
  }
}

export default Schema