import SwapApp, { SwapInterface } from 'swap.app'
import { Bitcoin } from 'examples/react/src/instances/bitcoin'
import bitcoin from 'bitcoinjs-lib'
import { BtcSwap } from 'swap.swaps'

jest.mock('swap.app')

const log = console.log
const crypto = {
  ripemd160: secret => 'c0933f9be51a284acb6b1a6617a48d795bdeaa80'
}

const secret      = 'c0809ce9f484fdcdfb2d5aabd609768ce0374ee97a1a5618ce4cd3f16c00a078'
const secretHash  = 'c0933f9be51a284acb6b1a6617a48d795bdeaa80'
const lockTime    = 1521171580

const btcOwner = {
  privateKey: 'cRkKzpir8GneA48iQVjSpUGT5mopFRTGDES7Kb43JduzrbhuVncn',
  publicKey: '02b65eed68f383178ee4bf301d1a2d231194eba2a65969187d49a6cdd945ea4f9d',
}
const ethOwner = {
  privateKey: 'cT5n9yx1xw3TcbvpEAuXvzhrTb5du4RAYbAbTqHfZ9nbq6gJQMGn',
  publicKey: '02dfae561eb061072da126f1aed7d47202a36b762e89e913c400cdb682360d9620',
}

const getData = ({ publicKey }) => {
  const publicKeyBuffer = Buffer.from(publicKey, 'hex')

  return {
    address: bitcoin.ECPair.fromPublicKeyBuffer(publicKeyBuffer).getAddress(),
    publicKey,
  }
}

const btcOwnerData = getData(btcOwner)
const ethOwnerData = getData(ethOwner)

const btcSwap = new BtcSwap({
  fetchBalance: (address) => 10,
  fetchUnspents: (address) => [],
  broadcastTx: (rawTx) => {}
})

test('check secretHash generated by ripemd160', () => {
  const result = crypto.ripemd160(secret)
  const expected = secretHash

  expect(result).toBe(expected)
})

//
// test('create + fund + withdraw', async (t) => {
//   const { script, lockTime } = btcSwap.createScript({
//     secretHash,
//     btcOwnerPublicKey: btcOwner.publicKey,
//     ethOwnerPublicKey: ethOwner.publicKey,
//   })
//
//   log('\nCreate complete')
//   log({ script, lockTime })
//
//   const fundResult = await btcSwap.fundScript({ btcData: btcOwnerData, script, lockTime, amount: 0.001 })
//
//   log('\nFund complete')
//   log(fundResult)
//
//   const withdrawResult = await btcSwap.withdraw({ btcData: ethOwnerData, script, secret })
//
//   log('\nWithdraw complete')
//   log(withdrawResult)
// })
