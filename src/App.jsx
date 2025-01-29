import React, {useState} from 'react';

/**
 * Format numbers with thousands separators and limit decimal places.
 */
function formatNumber(value, fractionDigits = 6) {
    if (!isFinite(value)) return '0';
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: fractionDigits
    }).format(value);
}

/**
 * Uniswap V2-like swap calculation (fee from input token).
 * Returns an object with:
 *   {
 *     amountOut,
 *     feeLP,
 *     feeTeam,
 *     feeTotal,
 *     slippage,
 *     priceExec
 *   }
 * `priceExec` is "outputAmount / inputAmountAfterFee"
 * (TON->USDT => USDT/TON, USDT->TON => TON/USDT).
 */
function calculateSwap({amountIn, inputReserve, outputReserve, fLP, fTeam}) {
    if (amountIn <= 0 || inputReserve <= 0 || outputReserve <= 0) {
        return {
            amountOut: 0,
            feeLP: 0,
            feeTeam: 0,
            feeTotal: 0,
            slippage: 0,
            priceExec: 0
        };
    }

    const totalFeeRate = fLP + fTeam;
    const feeTotal = amountIn * totalFeeRate;   // total input token fee
    const feeLP = feeTotal * (fLP / totalFeeRate);
    const feeTeam = feeTotal * (fTeam / totalFeeRate);
    const amountInAfterFee = amountIn - feeTotal;

    // Uniswap V2 formula
    const amountOut = (outputReserve * amountInAfterFee) / (inputReserve + amountInAfterFee);

    // Approx slippage
    const priceBefore = outputReserve / inputReserve;     // "market" price
    const priceExec = amountOut / amountInAfterFee;       // actual deal price
    let slippage = 0;
    if (priceBefore > 0) {
        slippage = (priceBefore - priceExec) / priceBefore;
    }

    return {
        amountOut,
        feeLP,
        feeTeam,
        feeTotal,
        slippage,
        priceExec
    };
}

function App() {
    // ---------------------------------------------------
    // POOL STATE
    // ---------------------------------------------------
    const [pool, setPool] = useState({
        x: 0,          // TON
        y: 0,          // USDT
        k: 0,          // product x*y
        totalLP: 0,    // total LP supply
        price: 0,      // price = y/x
        fLP: 0.002,    // e.g. 0.2%
        fTeam: 0.001,  // e.g. 0.1%
        teamEarningsTON: 0,
        teamEarningsUSDT: 0
    });

    // LP balances: providerId -> number
    const [lpBalances, setLpBalances] = useState({});
    // Operation log
    const [history, setHistory] = useState([]);

    // Helper: add logs
    const addHistory = (logObj) => {
        setHistory((prev) => [...prev, logObj]);
    };

    // Helper: update pool state (recalc k, price)
    const updatePoolState = (newPool, logObj) => {
        const {x, y} = newPool;
        newPool.k = x * y;
        newPool.price = x > 0 ? y / x : 0;
        setPool(newPool);
        if (logObj) addHistory(logObj);
    };

    // Helper: update LP balance for a provider
    const updateLPBalance = (providerId, delta) => {
        setLpBalances((prev) => {
            const oldBal = prev[providerId] || 0;
            return {...prev, [providerId]: oldBal + delta};
        });
    };

    // ---------------------------------------------------
    // 1. CREATE POOL (classic: LP = sqrt(x*y))
    // ---------------------------------------------------
    const [createPoolForm, setCreatePoolForm] = useState({
        ton: 1000,
        usdt: 4800,
        fLPpercent: 0.2,
        fTeampercent: 0.1,
        providerId: 'admin'
    });

    const handleCreatePool = () => {
        const X = parseFloat(createPoolForm.ton) || 0;
        const Y = parseFloat(createPoolForm.usdt) || 0;
        if (X <= 0 || Y <= 0) {
            alert('Please enter positive amounts for TON and USDT');
            return;
        }
        // Convert from % to decimal
        const fLPdecimal = parseFloat(createPoolForm.fLPpercent) / 100;
        const fTeamdecimal = parseFloat(createPoolForm.fTeampercent) / 100;

        // Standard Uniswap approach: LP init = sqrt(X*Y)
        const lpMinted = Math.sqrt(X * Y);

        const newPool = {
            x: X,
            y: Y,
            k: 0,
            totalLP: lpMinted,
            price: 0,
            fLP: fLPdecimal,
            fTeam: fTeamdecimal,
            teamEarningsTON: 0,
            teamEarningsUSDT: 0
        };

        updatePoolState(newPool, {
            operation: 'CREATE_POOL',
            message: `Pool created by ${createPoolForm.providerId}. TON=${formatNumber(X)}, USDT=${formatNumber(Y)}, LP=${formatNumber(lpMinted)}`
        });

        setLpBalances({[createPoolForm.providerId]: lpMinted});
    };

    // ---------------------------------------------------
    // 2. ADD LIQUIDITY (Uniswap-like: must keep ratio x/y)
    //    LP_new = totalLP * (deltaX / x) = totalLP*(deltaY / y)
    // ---------------------------------------------------
    const [addLiqForm, setAddLiqForm] = useState({
        ton: '',
        usdt: '',
        providerId: 'user1',
        lastChanged: 'ton'
    });

    /**
     * The user must provide tokens in proportion to the current ratio (y/x).
     * If the user changes "ton", we compute "usdt" = ton*(y/x).
     * If the user changes "usdt", we compute "ton" = usdt*(x/y).
     */
    const handleChangeAddLiquidity = (field, value) => {
        const {x, y} = pool;
        let {ton, usdt, lastChanged} = addLiqForm;
        let newTon = ton;
        let newUsdt = usdt;

        if (x <= 0 || y <= 0 || pool.totalLP <= 0) {
            // if pool not valid, do nothing or alert
        }

        if (field === 'ton') {
            newTon = value;
            lastChanged = 'ton';
            const tVal = parseFloat(newTon) || 0;
            // must keep the ratio: usdt = tVal*(y/x)
            const uVal = tVal * (y / x);
            newUsdt = uVal ? uVal.toFixed(6) : '';
        } else {
            newUsdt = value;
            lastChanged = 'usdt';
            const uVal = parseFloat(newUsdt) || 0;
            const tVal = uVal * (x / y);
            newTon = tVal ? tVal.toFixed(6) : '';
        }

        setAddLiqForm({...addLiqForm, ton: newTon, usdt: newUsdt, lastChanged});
    };

    const handleAddLiquidity = () => {
        let {ton, usdt, providerId} = addLiqForm;
        const tVal = parseFloat(ton) || 0;
        const uVal = parseFloat(usdt) || 0;
        if (tVal <= 0 || uVal <= 0) {
            alert('Please enter positive TON & USDT for liquidity');
            return;
        }

        let {x, y, totalLP, fLP, fTeam, teamEarningsTON, teamEarningsUSDT} = pool;

        // The user presumably matched ratio => deltaX = tVal, deltaY = uVal
        // Standard formula: LP_new = totalLP*(deltaX / x)
        // (or the same via deltaY / y)
        const lpNew = totalLP * (tVal / x); // (assuming ratio is correct)

        x += tVal;
        y += uVal;
        totalLP += lpNew;

        updatePoolState(
            {x, y, totalLP, fLP, fTeam, teamEarningsTON, teamEarningsUSDT},
            {
                operation: 'ADD_LIQUIDITY',
                message: `Provider ${providerId} added ${formatNumber(tVal)} TON & ${formatNumber(uVal)} USDT, gained LP=${formatNumber(lpNew)}`
            }
        );
        updateLPBalance(providerId, lpNew);

        setAddLiqForm({...addLiqForm, ton: '', usdt: ''});
    };

    // ---------------------------------------------------
    // 3. REMOVE LIQUIDITY
    //    If user wants to remove "ton" or "usdt", we figure out fraction
    //    fraction = ton / x or usdt / y
    //    Then remove fraction from the entire pool.
    // ---------------------------------------------------
    const [removeLiqForm, setRemoveLiqForm] = useState({
        ton: '',
        usdt: '',
        providerId: 'user1',
        lastChanged: 'ton',
        lpNeeded: 0
    });

    const handleChangeRemoveLiquidity = (field, value) => {
        let {ton, usdt, lastChanged} = removeLiqForm;
        const {x, y, totalLP} = pool;

        if (x <= 0 || y <= 0 || totalLP <= 0) {
            // do nothing
        }

        let newTon = ton;
        let newUsdt = usdt;

        if (field === 'ton') {
            newTon = value;
            lastChanged = 'ton';
            const tonVal = parseFloat(newTon) || 0;
            const fraction = tonVal / x;
            const usdtVal = fraction * y;
            newUsdt = usdtVal.toFixed(6);
        } else {
            newUsdt = value;
            lastChanged = 'usdt';
            const usdtVal = parseFloat(newUsdt) || 0;
            const fraction = usdtVal / y;
            const tonVal = fraction * x;
            newTon = tonVal.toFixed(6);
        }

        // LP needed = fraction*totalLP
        const tVal = parseFloat(newTon) || 0;
        const fraction2 = x > 0 ? tVal / x : 0;
        const neededLP = totalLP * fraction2;

        setRemoveLiqForm({
            ...removeLiqForm,
            ton: newTon,
            usdt: newUsdt,
            lastChanged,
            lpNeeded: neededLP
        });
    };

    const handleRemoveLiquidity = () => {
        let {ton, usdt, providerId, lpNeeded} = removeLiqForm;
        const tVal = parseFloat(ton) || 0;
        const uVal = parseFloat(usdt) || 0;
        const neededLP = lpNeeded;

        const userLPBalance = lpBalances[providerId] || 0;
        if (neededLP > userLPBalance) {
            alert(`Provider ${providerId} does not have enough LP. Required ${neededLP}, but has ${userLPBalance}`);
            return;
        }

        let {x, y, totalLP, fLP, fTeam, teamEarningsTON, teamEarningsUSDT} = pool;

        x -= tVal;
        y -= uVal;
        totalLP -= neededLP;
        if (totalLP < 0) totalLP = 0;

        updatePoolState(
            {x, y, totalLP, fLP, fTeam, teamEarningsTON, teamEarningsUSDT},
            {
                operation: 'REMOVE_LIQUIDITY',
                message: `Provider ${providerId} removed ~${formatNumber(tVal)} TON & ~${formatNumber(uVal)} USDT, burned LP=${formatNumber(neededLP)}`
            }
        );
        updateLPBalance(providerId, -neededLP);

        setRemoveLiqForm({...removeLiqForm, ton: '', usdt: '', lpNeeded: 0});
    };

    // ---------------------------------------------------
    // 4. SWAP (unchanged from previous)
    //    We'll keep the logic that "Execution Price" always shown as USDT/TON
    // ---------------------------------------------------
    const [swapForm, setSwapForm] = useState({
        direction: 'TON->USDT',
        ton: '',
        usdt: '',
        lastChanged: 'ton',
        maxSlippagePercent: 10,
        calcPriceExec: 0,
        calcSlippagePercent: 0
    });

    const handleChangeSwap = (field, value) => {
        const {direction} = swapForm;
        let {ton, usdt} = swapForm;
        let newLastChanged = field;

        const {x, y, fLP, fTeam} = pool;
        if (x <= 0 || y <= 0) {
            // do nothing
        }

        let newTon = ton;
        let newUsdt = usdt;

        if (field === 'ton') {
            newTon = value;
        } else {
            newUsdt = value;
        }

        const tonVal = parseFloat(newTon) || 0;
        const usdtVal = parseFloat(newUsdt) || 0;

        let calcPriceExec = 0;
        let calcSlippage = 0;

        if (direction === 'TON->USDT') {
            if (newLastChanged === 'ton') {
                // user edits TON in
                const res = calculateSwap({
                    amountIn: tonVal,
                    inputReserve: x,
                    outputReserve: y,
                    fLP,
                    fTeam
                });
                newUsdt = res.amountOut.toFixed(6);
                calcPriceExec = res.priceExec; // USDT/TON
                calcSlippage = res.slippage;
            } else {
                // user edits USDT out (approx reverse)
                const desiredOut = usdtVal;
                const totalFeeRate = fLP + fTeam;
                const R = 1 - totalFeeRate;
                let approxIn = 0;

                if (y - desiredOut > 0) {
                    const numerator = x * desiredOut;
                    const denom = R * (y - desiredOut);
                    approxIn = denom > 0 ? numerator / denom : 0;
                }
                newTon = approxIn.toFixed(6);

                const res2 = calculateSwap({
                    amountIn: approxIn,
                    inputReserve: x,
                    outputReserve: y,
                    fLP,
                    fTeam
                });
                calcPriceExec = res2.priceExec;
                calcSlippage = res2.slippage;
            }
        } else {
            // USDT->TON
            if (newLastChanged === 'usdt') {
                // user edits USDT in
                const res = calculateSwap({
                    amountIn: usdtVal,
                    inputReserve: y,
                    outputReserve: x,
                    fLP,
                    fTeam
                });
                newTon = res.amountOut.toFixed(6);
                // res.priceExec = TON/USDT => invert to show USDT/TON
                if (res.priceExec !== 0) {
                    calcPriceExec = 1 / res.priceExec;
                }
                calcSlippage = res.slippage;
            } else {
                // user edits TON out (approx reverse)
                const desiredOut = tonVal;
                const totalFeeRate = fLP + fTeam;
                const R = 1 - totalFeeRate;
                let approxIn = 0;

                if (x - desiredOut > 0) {
                    const numerator = y * desiredOut;
                    const denom = R * (x - desiredOut);
                    approxIn = denom > 0 ? numerator / denom : 0;
                }
                newUsdt = approxIn.toFixed(6);

                const res2 = calculateSwap({
                    amountIn: approxIn,
                    inputReserve: y,
                    outputReserve: x,
                    fLP,
                    fTeam
                });
                if (res2.priceExec !== 0) {
                    calcPriceExec = 1 / res2.priceExec;
                }
                calcSlippage = res2.slippage;
            }
        }

        setSwapForm({
            ...swapForm,
            ton: newTon,
            usdt: newUsdt,
            lastChanged: newLastChanged,
            calcPriceExec,
            calcSlippagePercent: calcSlippage * 100
        });
    };

    const handleSwap = () => {
        let {direction, ton, usdt, maxSlippagePercent} = swapForm;
        const maxSlipDecimal = parseFloat(maxSlippagePercent) / 100;

        let tonVal = parseFloat(ton) || 0;
        let usdtVal = parseFloat(usdt) || 0;

        let {x, y, totalLP, fLP, fTeam, teamEarningsTON, teamEarningsUSDT} = pool;

        if (direction === 'TON->USDT') {
            const res = calculateSwap({
                amountIn: tonVal,
                inputReserve: x,
                outputReserve: y,
                fLP,
                fTeam
            });
            if (res.slippage > maxSlipDecimal) {
                alert(`Swap canceled. Slippage ${(res.slippage * 100).toFixed(2)}% > ${maxSlippagePercent}%`);
                return;
            }
            const {amountOut, feeLP, feeTeam, slippage, priceExec} = res;
            if (amountOut > y) {
                alert('Not enough USDT in pool.');
                return;
            }
            x = x + (tonVal - feeTeam);
            y = y - amountOut;
            teamEarningsTON += feeTeam;

            updatePoolState(
                {x, y, totalLP, fLP, fTeam, teamEarningsTON, teamEarningsUSDT},
                {
                    operation: 'SWAP',
                    message: `SWAP TON->USDT. Input: ${formatNumber(tonVal)} TON, Output: ${formatNumber(amountOut)} USDT.
            Fees: LP=${formatNumber(feeLP)} TON, Team=${formatNumber(feeTeam)} TON.
            Execution Price=${priceExec.toFixed(6)} USDT/TON, Slippage=${(slippage * 100).toFixed(3)}%.
            Pool updated: X=${formatNumber(x)}, Y=${formatNumber(y)}.`
                }
            );
        } else {
            // USDT->TON
            const res = calculateSwap({
                amountIn: usdtVal,
                inputReserve: y,
                outputReserve: x,
                fLP,
                fTeam
            });
            if (res.slippage > maxSlipDecimal) {
                alert(`Swap canceled. Slippage ${(res.slippage * 100).toFixed(2)}% > ${maxSlippagePercent}%`);
                return;
            }
            const {amountOut, feeLP, feeTeam, slippage, priceExec} = res;
            if (amountOut > x) {
                alert('Not enough TON in pool.');
                return;
            }
            y = y + (usdtVal - feeTeam);
            x = x - amountOut;
            teamEarningsUSDT += feeTeam;

            let execPrice = 0;
            if (priceExec !== 0) {
                execPrice = 1 / priceExec; // USDT/TON
            }

            updatePoolState(
                {x, y, totalLP, fLP, fTeam, teamEarningsTON, teamEarningsUSDT},
                {
                    operation: 'SWAP',
                    message: `SWAP USDT->TON. Input: ${formatNumber(usdtVal)} USDT, Output: ${formatNumber(amountOut)} TON.
            Fees: LP=${formatNumber(feeLP)} USDT, Team=${formatNumber(feeTeam)} USDT.
            Execution Price=${execPrice.toFixed(6)} USDT/TON, Slippage=${(slippage * 100).toFixed(3)}%.
            Pool updated: X=${formatNumber(x)}, Y=${formatNumber(y)}.`
                }
            );
        }

        setSwapForm({
            ...swapForm,
            ton: '',
            usdt: '',
            calcPriceExec: 0,
            calcSlippagePercent: 0
        });
    };

    // ---------------------------------------------------
    // LAYOUT (three columns:
    //   Column1 = create/add/remove
    //   Column2 = swap
    //   Column3 = pool state + log)
    // ---------------------------------------------------
    return (
        <div style={{width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
            <h3 style={{textAlign: 'center', fontSize: '1.2rem', margin: '10px 0'}}>
                AMM DEX Simulator (x*y=k) - Uniswap-like LP
            </h3>

            <div
                style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    width: '95%',
                    gap: '20px'
                }}
            >
                {/* LEFT COLUMN: CREATE, ADD, REMOVE */}
                <div style={{display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, minWidth: '250px'}}>
                    {/* CREATE POOL */}
                    <div style={{border: '1px solid gray', padding: 10}}>
                        <h2 style={{fontSize: '1rem', margin: 0}}>Create Pool</h2>
                        <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 10}}>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>TON:</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={createPoolForm.ton}
                                    onChange={(e) => setCreatePoolForm({...createPoolForm, ton: e.target.value})}
                                />
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>USDT:</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={createPoolForm.usdt}
                                    onChange={(e) => setCreatePoolForm({...createPoolForm, usdt: e.target.value})}
                                />
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>LP Fee (%):</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={createPoolForm.fLPpercent}
                                    onChange={(e) => setCreatePoolForm({...createPoolForm, fLPpercent: e.target.value})}
                                />
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>Team Fee (%):</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={createPoolForm.fTeampercent}
                                    onChange={(e) => setCreatePoolForm({
                                        ...createPoolForm,
                                        fTeampercent: e.target.value
                                    })}
                                />
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>Provider ID:</label>
                                <input
                                    type="text"
                                    style={{flex: 1}}
                                    value={createPoolForm.providerId}
                                    onChange={(e) => setCreatePoolForm({...createPoolForm, providerId: e.target.value})}
                                />
                            </div>
                            <button onClick={handleCreatePool}>Create Pool</button>
                        </div>
                    </div>

                    {/* ADD LIQUIDITY */}
                    <div style={{border: '1px solid gray', padding: 10}}>
                        <h2 style={{fontSize: '1rem', margin: 0}}>Add Liquidity</h2>
                        <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 10}}>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>TON:</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={addLiqForm.ton}
                                    onChange={(e) => handleChangeAddLiquidity('ton', e.target.value)}
                                />
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>USDT:</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={addLiqForm.usdt}
                                    onChange={(e) => handleChangeAddLiquidity('usdt', e.target.value)}
                                />
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>Provider ID:</label>
                                <input
                                    type="text"
                                    style={{flex: 1}}
                                    value={addLiqForm.providerId}
                                    onChange={(e) => setAddLiqForm({...addLiqForm, providerId: e.target.value})}
                                />
                            </div>
                            <button onClick={handleAddLiquidity}>Add Liquidity</button>
                        </div>
                    </div>

                    {/* REMOVE LIQUIDITY */}
                    <div style={{border: '1px solid gray', padding: 10}}>
                        <h2 style={{fontSize: '1rem', margin: 0}}>Remove Liquidity</h2>
                        <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 10}}>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>Provider:</label>
                                <select
                                    style={{flex: 1}}
                                    value={removeLiqForm.providerId}
                                    onChange={(e) => setRemoveLiqForm({...removeLiqForm, providerId: e.target.value})}
                                >
                                    {Object.keys(lpBalances).length === 0 && <option value="user1">user1</option>}
                                    {Object.keys(lpBalances).map((pid) => (
                                        <option key={pid} value={pid}>
                                            {pid}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>LP owned: {formatNumber(lpBalances[removeLiqForm.providerId] || 0, 6)}</div>

                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>TON out:</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={removeLiqForm.ton}
                                    onChange={(e) => handleChangeRemoveLiquidity('ton', e.target.value)}
                                />
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>USDT out:</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={removeLiqForm.usdt}
                                    onChange={(e) => handleChangeRemoveLiquidity('usdt', e.target.value)}
                                />
                            </div>
                            <div>LP needed: {formatNumber(removeLiqForm.lpNeeded, 6)}</div>

                            <button onClick={handleRemoveLiquidity}>Remove Liquidity</button>
                        </div>
                    </div>
                </div>

                {/* MIDDLE COLUMN: SWAP */}
                <div style={{display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, minWidth: '250px'}}>
                    <div style={{border: '1px solid gray', padding: 10}}>
                        <h2 style={{fontSize: '1rem', margin: 0}}>Swap</h2>
                        <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 10}}>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>Direction:</label>
                                <select
                                    style={{flex: 1}}
                                    value={swapForm.direction}
                                    onChange={(e) => setSwapForm({...swapForm, direction: e.target.value})}
                                >
                                    <option value="TON->USDT">TON → USDT</option>
                                    <option value="USDT->TON">USDT → TON</option>
                                </select>
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>TON:</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={swapForm.ton}
                                    onChange={(e) => handleChangeSwap('ton', e.target.value)}
                                />
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>USDT:</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={swapForm.usdt}
                                    onChange={(e) => handleChangeSwap('usdt', e.target.value)}
                                />
                            </div>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{width: 120}}>Max Slippage (%):</label>
                                <input
                                    type="number"
                                    style={{flex: 1}}
                                    value={swapForm.maxSlippagePercent}
                                    onChange={(e) => setSwapForm({...swapForm, maxSlippagePercent: e.target.value})}
                                />
                            </div>
                            <div>
                                Execution
                                Price: {swapForm.calcPriceExec ? swapForm.calcPriceExec.toFixed(6) : '0'} USDT/TON
                            </div>
                            <div>Slippage (actual): {swapForm.calcSlippagePercent.toFixed(3)}%</div>
                            <button onClick={handleSwap}>Swap</button>
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: POOL STATE + LOG */}
                <div style={{display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, minWidth: '300px'}}>
                    <div style={{border: '1px solid gray', padding: 10}}>
                        <h2 style={{fontSize: '1rem', margin: 0}}>Pool State</h2>
                        <div style={{marginTop: 10}}>
                            <p>TON: {formatNumber(pool.x)}</p>
                            <p>USDT: {formatNumber(pool.y)}</p>
                            <p>k = {formatNumber(pool.k)}</p>
                            <p>LP Total: {formatNumber(pool.totalLP)}</p>
                            <p>LP Fee: {(pool.fLP * 100).toFixed(3)}%, Team Fee: {(pool.fTeam * 100).toFixed(3)}%</p>
                            <p>Price (TON→USDT): {pool.price.toFixed(6)}</p>
                            <p>
                                Team
                                Earnings: {formatNumber(pool.teamEarningsTON)} TON, {formatNumber(pool.teamEarningsUSDT)} USDT
                            </p>
                        </div>
                    </div>

                    <div style={{border: '1px solid gray', padding: 10}}>
                        <h2 style={{fontSize: '1rem', margin: 0}}>LP Balances</h2>
                        <div style={{marginTop: 10}}>
                            {Object.keys(lpBalances).length === 0 && <p>No LP providers yet.</p>}
                            {Object.keys(lpBalances).map((pid) => (
                                <p key={pid}>
                                    {pid}: {formatNumber(lpBalances[pid], 6)}
                                </p>
                            ))}
                        </div>
                    </div>

                    <div style={{border: '1px solid gray', padding: 10}}>
                        <h2 style={{fontSize: '1rem', margin: 0}}>Operation Log</h2>
                        <ul style={{marginTop: 10}}>
                            {history.map((item, index) => (
                                <li key={index}>
                                    <strong>{item.operation}</strong> : {item.message}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;
