import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parsePageItem, samePageItem } from '../src/content/page-item.ts'

describe('parsePageItem', () => {
  it('reads an issue and a pull request from their paths', () => {
    assert.deepEqual(parsePageItem('/acme/app/issues/12'), {
      repository: 'acme/app',
      number: 12,
    })
    assert.deepEqual(parsePageItem('/acme/app/pull/34'), {
      repository: 'acme/app',
      number: 34,
    })
  })

  it('reads a pull request from any of its own tabs', () => {
    for (const tail of ['/files', '/checks', '/commits/abc123', '/files#diff-1']) {
      assert.deepEqual(parsePageItem(`/acme/app/pull/34${tail}`), {
        repository: 'acme/app',
        number: 34,
      })
    }
  })

  it('says nothing about pages that are not one item', () => {
    for (const path of [
      '/',
      '/acme/app',
      '/acme/app/issues',
      '/acme/app/pulls',
      '/acme/app/issues/new',
      '/notifications',
      '/acme/app/blob/main/pull/34',
    ]) {
      assert.equal(parsePageItem(path), null, path)
    }
  })
})

describe('samePageItem', () => {
  const item = { repository: 'acme/app', number: 12 }

  it('compares by value, so a re-read of the same page is not a change', () => {
    assert.equal(samePageItem(item, { ...item }), true)
    assert.equal(samePageItem(item, { repository: 'acme/app', number: 13 }), false)
    assert.equal(samePageItem(item, { repository: 'acme/other', number: 12 }), false)
  })

  it('treats leaving an item and arriving at one as changes', () => {
    assert.equal(samePageItem(null, null), true)
    assert.equal(samePageItem(item, null), false)
    assert.equal(samePageItem(null, item), false)
  })
})
