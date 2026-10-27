import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { commaListAdvice } from '../src/lib/github/query.ts'

describe('commaListAdvice', () => {
  it('leaves a query without comma lists alone', () => {
    assert.equal(commaListAdvice('is:pr is:open author:@me repo:acme/app'), null)
  })

  it('leaves free text containing a comma alone', () => {
    assert.equal(commaListAdvice('is:pr fix the crash, again'), null)
  })

  it('expands a comma-separated repo list into an OR group', () => {
    const advice = commaListAdvice('is:pr is:open repo:acme/app,acme/web')
    assert.deepEqual(advice?.qualifiers, ['repo'])
    assert.equal(advice?.suggestion, 'is:pr is:open (repo:acme/app OR repo:acme/web)')
  })

  it('rewrites every affected qualifier and keeps the rest of the query', () => {
    const advice = commaListAdvice(
      'is:pr is:open (author:ann OR author:bo) AND repo:acme/app,acme/web,acme/api',
    )
    assert.deepEqual(advice?.qualifiers, ['repo'])
    assert.equal(
      advice?.suggestion,
      'is:pr is:open (author:ann OR author:bo) AND (repo:acme/app OR repo:acme/web OR repo:acme/api)',
    )
  })

  it('reports each qualifier given a list', () => {
    const advice = commaListAdvice('is:pr org:acme,globex author:ann,bo')
    assert.deepEqual(advice?.qualifiers, ['org', 'author'])
    assert.equal(
      advice?.suggestion,
      'is:pr (org:acme OR org:globex) (author:ann OR author:bo)',
    )
  })

  it('joins a negated list with AND, since it excludes every value', () => {
    const advice = commaListAdvice('is:pr -author:ann,bo')
    assert.equal(advice?.suggestion, 'is:pr (-author:ann AND -author:bo)')
  })

  it('keeps surrounding parentheses outside the group it adds', () => {
    const advice = commaListAdvice('is:pr (repo:acme/app,acme/web OR label:bug)')
    assert.equal(advice?.suggestion, 'is:pr ((repo:acme/app OR repo:acme/web) OR label:bug)')
  })

  it('preserves the original spacing', () => {
    const advice = commaListAdvice('is:pr   repo:acme/app,acme/web  is:open')
    assert.equal(advice?.suggestion, 'is:pr   (repo:acme/app OR repo:acme/web)  is:open')
  })

  it('accepts comma lists on the qualifiers that support them', () => {
    assert.equal(commaListAdvice('is:pr label:bug,ux in:title,body crash'), null)
    assert.equal(commaListAdvice('is:pr language:ruby,javascript'), null)
    assert.equal(commaListAdvice('is:issue linked:pr,issue'), null)
    assert.equal(commaListAdvice('is:issue type:Bug,Feature'), null)
    assert.equal(commaListAdvice('is:pr sort:created,asc'), null)
  })

  it('leaves a URL in the search terms alone', () => {
    assert.equal(commaListAdvice('is:issue https://example.com/a,b'), null)
  })

  it('leaves an unrecognised qualifier alone', () => {
    assert.equal(commaListAdvice('is:pr made-up:one,two'), null)
  })

  it('ignores a comma inside a quoted value', () => {
    assert.equal(commaListAdvice('is:pr assignee:"ann, bo"'), null)
  })

  it('ignores a comma inside a quoted value on a whitespace-splitting term', () => {
    const advice = commaListAdvice('is:pr milestone:"v1, final" repo:acme/app,acme/web')
    assert.deepEqual(advice?.qualifiers, ['repo'])
    assert.equal(
      advice?.suggestion,
      'is:pr milestone:"v1, final" (repo:acme/app OR repo:acme/web)',
    )
  })

  it('flags the enumerated qualifiers too', () => {
    assert.equal(
      commaListAdvice('repo:acme/app is:open,closed')?.suggestion,
      'repo:acme/app (is:open OR is:closed)',
    )
    assert.equal(
      commaListAdvice('repo:acme/app no:label,assignee')?.suggestion,
      'repo:acme/app (no:label OR no:assignee)',
    )
  })

  it('matches a qualifier whatever its case', () => {
    assert.equal(
      commaListAdvice('is:pr Repo:acme/app,acme/web')?.suggestion,
      'is:pr (Repo:acme/app OR Repo:acme/web)',
    )
  })

  it('ignores a trailing comma, which lists only one value', () => {
    assert.equal(commaListAdvice('is:pr repo:acme/app,'), null)
  })
})
