import crypto from 'bitcoinjs-lib/src/crypto' // move to BtcSwap
import SwapApp, { constants } from 'swap.app'
import { Flow } from 'swap.swap'


export default (tokenName) => {

  class ETHTOKEN2USDT extends Flow {

    static getName() {
      return `${tokenName.toUpperCase()}2${constants.COINS.usdt}`
    }

    constructor(swap) {
      super(swap)

      this._flowName = ETHTOKEN2USDT.getName()

      this.ethTokenSwap = SwapApp.swaps[tokenName.toUpperCase()]
      this.usdtSwap      = SwapApp.swaps[constants.COINS.usdt]

      this.myBtcAddress = SwapApp.services.auth.accounts.btc.getAddress()
      this.myEthAddress = SwapApp.services.auth.accounts.eth.address

      this.stepNumbers = {
        'sign': 1,
        'wait-lock-usdt': 2,
        'verify-script': 3,
        'sync-balance': 4,
        'lock-eth': 5,
        'wait-withdraw-eth': 6, // aka getSecret
        'withdraw-usdt': 7,
        'finish': 8,
        'end': 9
      }

      if (!this.ethTokenSwap) {
        throw new Error('ETHTOKEN2USDT: "ethTokenSwap" of type object required')
      }
      if (!this.usdtSwap) {
        throw new Error('ETHTOKEN2USDT: "usdtSwap" of type object required')
      }

      this.state = {
        step: 0,

        signTransactionHash: null,
        isSignFetching: false,
        isMeSigned: false,

        secretHash: null,
        btcScriptValues: null,

        btcScriptVerified: false,

        isBalanceFetching: false,
        isBalanceEnough: false,
        balance: null,

        // usdtFundingTransactionHash: null,
        usdtFundingTransactionHash: null,
        usdtRawRedeemTransactionHex: null,

        ethSwapCreationTransactionHash: null,
        usdtSwapWithdrawTransactionHash: null,

        isEthContractFunded: false,

        secret: null,

        isEthWithdrawn: false,
        isBtcWithdrawn: false,

        refundTransactionHash: null,

        isFinished: false,
      }

      super._persistSteps()
      this._persistState()
    }

    _persistState() {
      super._persistState()
    }

    _getSteps() {
      const flow = this

      return [

        // 1. Sign swap to start

        () => {
          // this.sign()
        },

        // 2. Wait participant create, fund USDT Script

        () => {
          flow.swap.room.once('create btc script', ({ scriptValues, usdtFundingTransactionHash, usdtRawRedeemTransactionHex }) => {
            flow.finishStep({
              secretHash: scriptValues.secretHash,
              btcScriptValues: scriptValues,
              usdtFundingTransactionHash,
              usdtRawRedeemTransactionHex,
            }, { step: 'wait-lock-usdt', silentError: true })
          })

          flow.swap.room.sendMessage('request btc script')
        },

        // 3. Verify USDT Script

        () => {
          // this.verifyBtcScript()
        },

        // 4. Check balance

        () => {
          this.syncBalance()
        },

        // 5. Create ETH Contract

        async () => {
          const { participant, buyAmount, sellAmount } = flow.swap
          let ethSwapCreationTransactionHash

          // TODO move this somewhere!
          const utcNow = () => Math.floor(Date.now() / 1000)
          const getLockTime = () => utcNow() + 3600 * 1 // 1 hour from now

          const scriptCheckResult = await flow.usdtSwap.checkScript(flow.state.usdtScriptValues, {
            value: buyAmount,
            recipientPublicKey: SwapApp.services.auth.accounts.btc.getPublicKey(),
            lockTime: getLockTime(),
          })

          if (scriptCheckResult) {
            console.error(`Btc script check error:`, scriptCheckResult)
            flow.swap.events.dispatch('usdt script check error', scriptCheckResult)
            return
          }

          const swapData = {
            participantAddress:   participant.eth.address,
            secretHash:           flow.state.secretHash,
            amount:               sellAmount,
          }

          await flow.ethTokenSwap.approve({
            amount: sellAmount,
          })

          await flow.ethTokenSwap.create(swapData, (hash) => {
            ethSwapCreationTransactionHash = hash

            flow.setState({
              ethSwapCreationTransactionHash: hash,
            })
          })

          flow.swap.room.sendMessage('create eth contract', {
            ethSwapCreationTransactionHash,
          })

          flow.finishStep({
            isEthContractFunded: true,
          })
        },

        // 6. Wait participant withdraw

        () => {
          const { participant } = flow.swap
          let timer

          const checkSecretExist = () => {
            timer = setTimeout(async () => {
              let secret

              try {
                secret = await flow.ethTokenSwap.getSecret({
                  participantAddress: participant.eth.address,
                })
              }
              catch (err) {}

              if (secret) {
                if (!flow.state.isEthWithdrawn) { // redundant condition but who cares :D
                  flow.finishStep({
                    isEthWithdrawn: true,
                    secret,
                  }, { step: 'wait-withdraw-eth' })
                }
              }
              else {
                checkSecretExist()
              }
            }, 20 * 1000)
          }

          checkSecretExist()

          flow.swap.room.once('finish eth withdraw', () => {
            if (!flow.state.isEthWithdrawn) {
              clearTimeout(timer)
              timer = null

              flow.finishStep({
                isEthWithdrawn: true,
              }, { step: 'wait-withdraw-eth' })
            }
          })
        },

        // 7. Withdraw

        async () => {
          const { participant } = flow.swap
          let { secret } = flow.state

          const data = {
            participantAddress: participant.eth.address,
          }

          // if there is no secret in state then request it
          if (!secret) {
            try {
              secret = await flow.ethTokenSwap.getSecret(data)

              flow.setState({
                secret,
              })
            }
            catch (err) {
              // TODO notify user that smth goes wrong
              if ( !/known transaction/.test(err.message) )
                console.error(err)
              return
            }
          }

          // if there is still no secret stop withdraw
          if (!secret) {
            console.error(`Secret required! Got ${secret}`)
            return
          }


          await flow.usdtSwap.withdraw({
            scriptValues: flow.state.usdtScriptValues,
            secret,
          }, (hash) => {
            flow.setState({
              usdtSwapWithdrawTransactionHash: hash,
            })
          })

          flow.finishStep({
            isBtcWithdrawn: true,
          })
        },


        // 8. Finish

        () => {
          flow.swap.room.sendMessage('swap finished')

          flow.finishStep({
            isFinished: true
          })
        },

        // 9. Finished!

        () => {

        },
      ]
    }

    _checkSwapAlreadyExists() {
      const { participant } = this.swap

      const swapData = {
        ownerAddress:       SwapApp.services.auth.accounts.eth.address,
        participantAddress: participant.eth.address
      }

      return this.ethTokenSwap.checkSwapExists(swapData)
    }

    async sign() {
      const { participant } = this.swap
      const { isMeSigned } = this.state

      if (isMeSigned) return this.swap.room.sendMessage('swap sign')

      const swapExists = await this._checkSwapAlreadyExists()

      if (swapExists) {
        this.swap.room.sendMessage('swap exists')
        // TODO go to 6 step automatically here
        throw new Error(`Cannot sign: swap with ${participant.eth.address} already exists! Please refund it or drop ${this.swap.id}`)
        return false
      }

      this.setState({
        isSignFetching: true,
      })

      this.swap.room.once('request sign', () => {
        this.swap.room.sendMessage('swap sign')
      })

      this.swap.room.sendMessage('swap sign')

      this.finishStep({
        isMeSigned: true,
      }, { step: 'sign' })

      return true
    }

    verifyBtcScript() {
      if (this.state.usdtScriptVerified) return true
      if (!this.state.usdtScriptValues)
        throw new Error(`No script, cannot verify`)

      this.finishStep({
        usdtScriptVerified: true,
      }, { step: 'verify-script' })

      return true
    }

    async syncBalance() {
      const { sellAmount } = this.swap

      this.setState({
        isBalanceFetching: true,
      })

      const balance = await this.ethTokenSwap.fetchBalance(SwapApp.services.auth.accounts.eth.address)
      const isEnoughMoney = sellAmount.isLessThanOrEqualTo(balance)

      if (isEnoughMoney) {
        this.finishStep({
          balance,
          isBalanceFetching: false,
          isBalanceEnough: true,
        }, { step: 'sync-balance' })
      }
      else {
        this.setState({
          balance,
          isBalanceFetching: false,
          isBalanceEnough: false,
        })
      }
    }

    async tryWithdraw(_secret) {
      const { secret, secretHash, isEthWithdrawn, isBtcWithdrawn, usdtScriptValues } = this.state

      if (!_secret)
        throw new Error(`Withdrawal is automatic. For manual withdrawal, provide a secret`)

      if (!usdtScriptValues)
        throw new Error(`Cannot withdraw without script values`)

      if (secret && secret != _secret)
        console.warn(`Secret already known and is different. Are you sure?`)

      if (isBtcWithdrawn)
        console.warn(`Looks like money were already withdrawn, are you sure?`)

      console.log(`WITHDRAW using secret = ${_secret}`)

      const _secretHash = crypto.ripemd160(Buffer.from(_secret, 'hex')).toString('hex')

      if (secretHash != _secretHash)
        console.warn(`Hash does not match!`)

      const { scriptAddress } = this.usdtSwap.createScript(usdtScriptValues)

      const balance = await this.usdtSwap.getBalance(scriptAddress)

      console.log(`address=${scriptAddress}, balance=${balance}`)

      if (balance === 0) {
        flow.finishStep({
          isBtcWithdrawn: true,
        }, { step: 'withdraw-usdt' })

        throw new Error(`Already withdrawn: address=${scriptAddress},balance=${balance}`)
      }

      await this.usdtSwap.withdraw({
        scriptValues: usdtScriptValues,
        usdtRawRedeemTransactionHex,
        secret: _secret,
      }, (hash) => {
        console.log(`TX hash=${hash}`)
        this.setState({
          usdtSwapWithdrawTransactionHash: hash,
        })
      })

      console.log(`TX withdraw sent: ${this.state.usdtSwapWithdrawTransactionHash}`)

      this.finishStep({
        isBtcWithdrawn: true,
      }, { step: 'withdraw-usdt' })
    }

    async tryRefund() {
      const { participant } = this.swap
      let { secret, usdtScriptValues } = this.state

      secret = 'c0809ce9f484fdcdfb2d5aabd609768ce0374ee97a1a5618ce4cd3f16c00a078'

      try {
        console.log('TRYING REFUND!')

        try {
          await this.ethTokenSwap.refund({
            participantAddress: participant.eth.address,
          }, (hash) => {
            this.setState({
              refundTransactionHash: hash,
            })
          })

          console.log('SUCCESS REFUND!')
          return
        }
        catch (err) {
          console.err('REFUND FAILED!', err)
        }
      }
      catch (err) {
        console.error(`Mbe it's still under lockTime?! ${err}`)
      }

      if (!usdtScriptValues) {
        console.error('You can\'t do refund w/o usdt script values! Try wait until lockTime expires on eth contract!')
      }

      if (!secret) {
        try {
          secret = await this.ethTokenSwap.getSecret(data)
        }
        catch (err) {
          console.error('Can\'t receive secret from contract')
          return
        }
      }

      console.log('TRYING WITHDRAW!')

      try {
        await this.usdtSwap.withdraw({
          scriptValues: this.state.usdtScriptValues,
          secret,
        }, (hash) => {
          this.setState({
            usdtSwapWithdrawTransactionHash: hash,
          })
        })

        console.log('SUCCESS WITHDRAW!')
      }
      catch (err) {
        console.error('WITHDRAW FAILED!', err)
      }
    }
  }

  return ETHTOKEN2USDT
}
