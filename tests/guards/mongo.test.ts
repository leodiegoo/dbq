import { describe, expect, it } from 'vitest';
import { guardMongo } from '../../src/guards/mongo.ts';
import { DbqError } from '../../src/errors.ts';

const refuses = (expr: string) => {
  let thrown: unknown;
  try {
    guardMongo(expr);
  } catch (err) {
    thrown = err;
  }
  expect(thrown, `should refuse: ${expr}`).toBeInstanceOf(DbqError);
  expect((thrown as DbqError).code, `should refuse: ${expr}`).toBe('READONLY_VIOLATION');
};

describe('guardMongo — accepted expressions', () => {
  it('should be parsing a bare find', () => {
    expect(guardMongo('db.companies.find({ active: true })')).toEqual({
      kind: 'mongo',
      collection: 'companies',
      operation: 'find',
      args: [{ active: true }],
      modifiers: {},
    });
  });

  it('should be parsing find with no arguments', () => {
    expect(guardMongo('db.companies.find()').args).toEqual([]);
  });

  it('should be collecting chained modifiers', () => {
    const plan = guardMongo('db.companies.find({}).sort({ createdAt: -1 }).skip(5).limit(10)');
    expect(plan.modifiers).toEqual({ sort: { createdAt: -1 }, skip: 5, limit: 10 });
  });

  it('should be parsing a projection passed as the second find argument', () => {
    expect(guardMongo('db.companies.find({}, { name: 1 })').args).toEqual([{}, { name: 1 }]);
  });

  it('should be parsing an aggregate pipeline', () => {
    const plan = guardMongo('db.orders.aggregate([{ $match: { paid: true } }, { $group: { _id: "$userId" } }])');
    expect(plan.operation).toBe('aggregate');
    expect(plan.args).toEqual([[{ $match: { paid: true } }, { $group: { _id: '$userId' } }]]);
  });

  it('should be accepting every whitelisted read operation', () => {
    expect(guardMongo('db.c.findOne({})').operation).toBe('findOne');
    expect(guardMongo('db.c.countDocuments({})').operation).toBe('countDocuments');
    expect(guardMongo('db.c.estimatedDocumentCount()').operation).toBe('estimatedDocumentCount');
    expect(guardMongo('db.c.distinct("status")').operation).toBe('distinct');
  });

  it('should be accepting a regex literal in a filter', () => {
    const plan = guardMongo('db.companies.find({ name: /acme/i })');
    expect((plan.args[0] as { name: RegExp }).name).toBeInstanceOf(RegExp);
  });

  it('should be accepting negative numbers', () => {
    expect(guardMongo('db.c.find({ score: -1 })').args).toEqual([{ score: -1 }]);
  });

  it('should be accepting quoted keys', () => {
    expect(guardMongo('db.c.find({ "a.b": 1 })').args).toEqual([{ 'a.b': 1 }]);
  });

  it('should be accepting a trailing semicolon', () => {
    expect(guardMongo('db.c.find({});').operation).toBe('find');
  });

  it('should be accepting a collection name with underscores', () => {
    expect(guardMongo('db.my_coll.find({})').collection).toBe('my_coll');
  });
});

describe('guardMongo — refused expressions', () => {
  it('should be refusing write operations', () => {
    for (const expr of [
      'db.c.drop()',
      'db.c.insertOne({})',
      'db.c.insertMany([])',
      'db.c.updateOne({}, {})',
      'db.c.updateMany({}, {})',
      'db.c.deleteOne({})',
      'db.c.deleteMany({})',
      'db.c.replaceOne({}, {})',
      'db.c.findOneAndUpdate({}, {})',
      'db.c.bulkWrite([])',
      'db.c.createIndex({})',
      'db.c.renameCollection("x")',
    ]) {
      refuses(expr);
    }
  });

  it('should be refusing computed member access', () => {
    refuses('db["compa" + "nies"]["dr" + "op"]()');
    refuses('db.companies["drop"]()');
  });

  it('should be refusing chained statements', () => {
    refuses('db.c.find({}); db.d.drop()');
  });

  it('should be refusing a base that is not db', () => {
    refuses('process.exit(1)');
    refuses('other.c.find({})');
  });

  it('should be refusing a chain operation outside the whitelist', () => {
    refuses('db.c.find({}).forEach(x => x)');
    refuses('db.c.find({}).explain()');
    refuses('db.c.find({}).toArray()');
  });

  it('should be refusing non-literal arguments', () => {
    refuses('db.c.find({ a: someVar })');
    refuses('db.c.find({ a: fn() })');
    refuses('db.c.find({ a: `tpl${1}` })');
    refuses('db.c.find({ a: 1 + 1 })');
    refuses('db.c.find({ a: () => 1 })');
    refuses('db.c.find({ a: new Date() })');
    refuses('db.c.find({ ...spread })');
    refuses('db.c.find({ [key]: 1 })');
  });

  it('should be refusing $out anywhere in a pipeline', () => {
    refuses('db.c.aggregate([{ $out: "backup" }])');
    refuses('db.c.aggregate([{ $match: {} }, { $out: "backup" }])');
  });

  it('should be refusing $merge anywhere in a pipeline', () => {
    refuses('db.c.aggregate([{ $merge: { into: "backup" } }])');
  });

  it('should be refusing $out nested deep inside an argument', () => {
    refuses('db.c.aggregate([{ $facet: { a: [{ $out: "x" }] } }])');
  });

  it('should be refusing server-side javascript operators', () => {
    refuses('db.c.find({ $where: "this.a == 1" })');
    refuses('db.c.aggregate([{ $group: { _id: null, t: { $accumulator: {} } } }])');
    refuses('db.c.aggregate([{ $addFields: { x: { $function: {} } } }])');
  });

  it('should be refusing a forbidden key nested inside an array', () => {
    refuses('db.c.find({ $and: [{ $where: "true" }] })');
  });

  it('should be refusing syntactically invalid input', () => {
    refuses('db.c.find({');
    refuses('   ');
  });

  it('should be refusing a non-numeric limit', () => {
    refuses('db.c.find({}).limit("10")');
  });

  it('should be attaching a hint listing the read operations', () => {
    try {
      guardMongo('db.c.drop()');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DbqError).hint).toContain('find');
    }
  });
});
