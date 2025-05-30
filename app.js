document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Elements ---
  const inputs = {
    userBirthdate: document.getElementById("user-birthdate"),
    lmpAmount: document.getElementById("lmp-amount"),
    lmpRate: document.getElementById("lmp-rate"),
    lmpYears: document.getElementById("lmp-years"),
    startBalance: document.getElementById("start-balance"),
    horizonYears: document.getElementById("horizon-years"),
    stockPct: document.getElementById("stock-pct"),
    bondPct: document.getElementById("bond-pct"),
    stockReturn: document.getElementById("stock-return"),
    stockSigma: document.getElementById("stock-sigma"),
    bondReturn: document.getElementById("bond-return"),
    bondSigma: document.getElementById("bond-sigma"),
    legacyTarget: document.getElementById("legacy-target"),
    nSims: document.getElementById("n-sims"),
    maxSpending: document.getElementById("max-spending"),
    showSources: document.getElementById("show-sources"),
    displayMonthly: document.getElementById("display-monthly"),
  };

  const outputs = {
    legacy95th: document.getElementById("legacy-95th"),
    legacy50th: document.getElementById("legacy-50th"),
    legacy5th: document.getElementById("legacy-5th"),
    summaryLmpCost: document.getElementById("summary-lmp-cost"),
    summaryRiskStart: document.getElementById("summary-risk-start"),
    summaryW0: document.getElementById("summary-w0"),
    chartMainTitle: document.getElementById("chart-main-title"),
  };

  const runSimButton = document.getElementById("run-sim");
  const exportCsvButton = document.getElementById("export-csv");
  const spendingChartCanvas = document.getElementById("spending-chart");
  let spendingChart = null;
  let allSimData = []; // To store raw data for CSV export

  // --- Helper Functions ---
  const parseFloatInput = (element, defaultValue = 0) =>
    parseFloat(element.value) || defaultValue;
  const parseIntInput = (element, defaultValue = 0) =>
    parseInt(element.value) || defaultValue;

  // Standard Normal variate using Box-Muller transform
  function randomNormal() {
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random(); //Converting [0,1) to (0,1)
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function getNormalRandom(mean, stdDev) {
    return mean + stdDev * randomNormal();
  }

  function formatCurrency(value) {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  // --- LMP Logic ---
  function calcLmpCost(amount, rate, years) {
    if (rate === 0) return amount * years;
    // PV of an ordinary annuity formula: P = A * [1 - (1 + r)^-n] / r
    return (amount * (1 - Math.pow(1 + rate, -years))) / rate;
  }

  // --- Amortization Logic ---
  function calcWithdrawal(balance, rate, years, legacyTarget) {
    if (years <= 0) return 0;
    if (rate === 0) {
      return (balance - legacyTarget) / years;
    }
    // PMT formula: PMT = P * [r(1+r)^n] / [(1+r)^n - 1]
    // We adjust for legacyTarget: P = balance - legacyTarget / (1+r)^n
    const adjustedBalance = balance - legacyTarget / Math.pow(1 + rate, years);
    if (adjustedBalance <= 0) return 0; // Cannot withdraw if adjusted balance is negative

    const numerator = adjustedBalance * rate * Math.pow(1 + rate, years);
    const denominator = Math.pow(1 + rate, years) - 1;
    if (denominator === 0) return adjustedBalance / years; // Avoid division by zero if rate is tiny
    return numerator / denominator;
  }

  // --- Monte Carlo Simulation ---
  function runMonteCarlo(settings) {
    const resultsByYear = Array(settings.horizonYears)
      .fill(null)
      .map(() => []);
    const legacyOutcomes = [];
    allSimData = []; // Clear previous data

    const lmpCost = calcLmpCost(
      settings.lmpAmount,
      settings.lmpRate / 100,
      Math.min(settings.lmpYears, settings.horizonYears)
    );
    const riskStart = settings.startBalance - lmpCost;

    if (riskStart < 0) {
      alert(
        "Warning: LMP cost exceeds starting portfolio balance. Risk portfolio starts negative."
      );
    }

    // Calculate the average portfolio return for amortization
    // Weighted average of stock and bond returns
    const avgPortfolioReturn =
      ((settings.stockPct / 100) * settings.stockReturn) / 100 +
      ((settings.bondPct / 100) * settings.bondReturn) / 100;

    const W0 = calcWithdrawal(
      riskStart,
      avgPortfolioReturn,
      settings.horizonYears,
      settings.legacyTarget
    );

    // Update summary display
    outputs.summaryLmpCost.textContent = formatCurrency(lmpCost);
    outputs.summaryRiskStart.textContent = formatCurrency(riskStart);
    outputs.summaryW0.textContent = formatCurrency(W0);

    for (let i = 0; i < settings.nSims; i++) {
      let currentBalance = riskStart;
      let Wt_minus_1 = W0; // Initial withdrawal from risk portfolio
      const simPath = [];

      for (let t = 0; t < settings.horizonYears; t++) {
        let currentYearWithdrawal = Wt_minus_1;

        // Floor withdrawal at 0 if balance is 0 or negative
        if (currentBalance <= 0) {
          currentYearWithdrawal = 0;
        }

        let actualWithdrawalFromRisk = Math.min(
          currentYearWithdrawal,
          currentBalance
        );
        actualWithdrawalFromRisk = Math.max(0, actualWithdrawalFromRisk); // Ensure non-negative

        let balanceAfterWithdrawal = currentBalance - actualWithdrawalFromRisk;

        // Investment growth
        const r_stock = getNormalRandom(
          settings.stockReturn / 100,
          settings.stockSigma / 100
        );
        const r_bond = getNormalRandom(
          settings.bondReturn / 100,
          settings.bondSigma / 100
        );

        const portfolioReturn =
          (settings.stockPct / 100) * r_stock +
          (settings.bondPct / 100) * r_bond;
        let balanceAfterGrowth = balanceAfterWithdrawal * (1 + portfolioReturn);

        // If balance is extremely small and negative, cap it at 0 to prevent large negative numbers
        if (balanceAfterGrowth < -1e6) balanceAfterGrowth = 0; // Heuristic to prevent massive negative values
        currentBalance = Math.max(0, balanceAfterGrowth); // Floor balance at 0 for next period calculations

        // Re-amortize for next year's withdrawal
        const remainingYears = settings.horizonYears - (t + 1);
        let Wt_next = calcWithdrawal(
          currentBalance,
          avgPortfolioReturn,
          remainingYears,
          settings.legacyTarget
        );

        // Enforce maxSpending cap (on risk portfolio portion)
        if (settings.maxSpending !== null && settings.maxSpending > 0) {
          Wt_next = Math.min(Wt_next, settings.maxSpending);
        }
        Wt_next = Math.max(0, Wt_next); // Ensure non-negative withdrawal

        // Record total withdrawal for the year (LMP + Risk Portfolio)
        // LMP provides funding for min(t+1, lmpYears)
        const lmpContributionThisYear =
          t < settings.lmpYears ? settings.lmpAmount : 0;
        const riskPortionToRecord = actualWithdrawalFromRisk; // This is what was ACTUALLY taken from risk

        resultsByYear[t].push({
          totalSpending: lmpContributionThisYear + riskPortionToRecord,
          lmpComponent: lmpContributionThisYear,
          riskComponent: riskPortionToRecord,
        });

        simPath.push({
          year: t + 1,
          sim: i + 1,
          startBalanceForYear:
            t === 0 ? riskStart : simPath[t - 1].endBalanceForYear, // approx
          withdrawalFromRisk: riskPortionToRecord,
          lmpPayment: lmpContributionThisYear,
          totalSpending: lmpContributionThisYear + riskPortionToRecord,
          endBalanceForYear: currentBalance,
        });

        Wt_minus_1 = Wt_next; // Setup for next iteration
      }
      legacyOutcomes.push(currentBalance);
      allSimData.push(...simPath);
    }
    return { resultsByYear, legacyOutcomes };
  }

  // --- Aggregation & Percentiles ---
  function calculatePercentiles(data, percentiles = [0.05, 0.5, 0.95]) {
    const sortedData = [...data].sort((a, b) => a - b);
    const results = {};
    percentiles.forEach((p) => {
      const index = Math.floor(p * (sortedData.length - 1)); // Simple approach
      results[p] = sortedData[index];
    });
    results.min = sortedData[0];
    results.max = sortedData[sortedData.length - 1];
    return results;
  }

  // --- Charting Logic ---
  function updateChart(resultsByYear, settings) {
    if (spendingChart) {
      spendingChart.destroy();
    }

    const displayMonthly = settings.displayMonthly;
    const divisor = displayMonthly ? 12 : 1;
    const timeUnit = displayMonthly ? "Monthly" : "Annual";
    outputs.chartMainTitle.textContent = `${timeUnit} Spending During Retirement`;

    const labels = [];
    const userBirthYear = new Date(settings.userBirthdate).getFullYear();
    for (let i = 0; i < settings.horizonYears; i++) {
      labels.push(
        `Year ${i + 1} (Age ${
          userBirthYear +
          i -
          new Date().getFullYear() +
          (new Date(settings.userBirthdate).getFullYear() - userBirthYear) +
          (settings.currentAge || new Date().getFullYear() - userBirthYear)
        })`
      );
    }

    const startAge =
      settings.currentAge ||
      new Date().getFullYear() - new Date(settings.userBirthdate).getFullYear();
    const chartLabels = Array.from(
      { length: settings.horizonYears },
      (_, i) => `Age ${startAge + i}`
    );

    const datasets = [];
    const medianData = [];
    const rangeData5th95th = []; // For floating bars: [low, high]

    resultsByYear.forEach((yearDataPoints) => {
      const spendingValues = yearDataPoints.map((dp) => {
        if (settings.showSources) return dp.totalSpending / divisor;
        return (dp.lmpComponent + dp.riskComponent) / divisor; // Same as totalSpending
      });
      const percentiles = calculatePercentiles(spendingValues);
      medianData.push(percentiles[0.5]);
      rangeData5th95th.push([percentiles[0.05], percentiles[0.95]]);
    });

    // Dataset for the 5th-95th percentile range (using floating bar)
    datasets.push({
      label: "5th-95th Percentile Spending",
      data: rangeData5th95th,
      backgroundColor: "rgba(121, 165, 197, 0.3)", // Light purple-blue
      borderColor: "rgba(121, 165, 197, 0.5)",
      borderWidth: 1,
      barPercentage: 0.8,
      categoryPercentage: 0.9,
      order: 2,
    });

    // Dataset for the median line
    datasets.push({
      label: "Median Spending",
      data: medianData,
      type: "line",
      borderColor: "#3e6482", // Darker purple-blue
      backgroundColor: "#3e6482",
      fill: false,
      tension: 0.1,
      borderWidth: 2,
      pointRadius: 0,
      order: 1,
    });

    if (settings.showSources) {
      const lmpBaseData = [];
      const riskMedianData = [];
      const riskRangeData5th95th = [];

      resultsByYear.forEach((yearDataPoints) => {
        const lmpAmountForYear =
          (yearDataPoints[0] ? yearDataPoints[0].lmpComponent : 0) / divisor; // LMP is fixed for all sims in a year
        lmpBaseData.push(lmpAmountForYear);

        const riskSpendingValues = yearDataPoints.map(
          (dp) => dp.riskComponent / divisor
        );
        const riskPercentiles = calculatePercentiles(riskSpendingValues);

        riskMedianData.push(lmpAmountForYear + riskPercentiles[0.5]); // Stacked on LMP
        riskRangeData5th95th.push([
          lmpAmountForYear + riskPercentiles[0.05],
          lmpAmountForYear + riskPercentiles[0.95],
        ]);
      });

      // Override default datasets if showing sources
      datasets.length = 0; // Clear existing datasets

      // LMP Base (as a bar, could be a filled area under a line too)
      datasets.push({
        label: "LMP Guaranteed Spending",
        data: lmpBaseData,
        backgroundColor: "rgba(119, 172, 119, 0.6)", // Greenish
        borderColor: "rgba(119, 172, 119, 1)",
        borderWidth: 1,
        type: "bar",
        barPercentage: 0.8,
        categoryPercentage: 0.9,
        order: 3, // Draw first
        stack: "combined",
      });

      // Risk Portfolio Range (5th-95th) - this needs to be calculated as the ADDITION to LMP
      const riskContributionRange = resultsByYear.map((yearDataPoints) => {
        const riskSpendingValues = yearDataPoints.map(
          (dp) => dp.riskComponent / divisor
        );
        const p = calculatePercentiles(riskSpendingValues, [0.05, 0.95]);
        return [p[0.05], p[0.95]]; // This is just the risk part
      });

      datasets.push({
        label: "Risk Portfolio Spending (5th-95th)",
        data: riskContributionRange,
        backgroundColor: "rgba(121, 165, 197, 0.3)", // Light purple-blue
        borderColor: "rgba(121, 165, 197, 0.5)",
        borderWidth: 1,
        type: "bar", // Floating bar for the risk component
        barPercentage: 0.8,
        categoryPercentage: 0.9,
        order: 2,
        stack: "combined", // This makes it stack on the LMP
      });

      // Median Total Spending Line
      const totalMedianData = resultsByYear.map((yearDataPoints) => {
        const totalSpendingValues = yearDataPoints.map(
          (dp) => (dp.lmpComponent + dp.riskComponent) / divisor
        );
        return calculatePercentiles(totalSpendingValues, [0.5])[0.5];
      });
      datasets.push({
        label: "Median Total Spending",
        data: totalMedianData,
        type: "line",
        borderColor: "#3e6482",
        fill: false,
        tension: 0.1,
        borderWidth: 2,
        pointRadius: 0,
        order: 1,
      });
    }

    const chartConfig = {
      type: "bar", // Base type, individual datasets can override
      data: {
        labels: chartLabels,
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: {
              display: true,
              text: "Retirement Year / Age",
            },
            stacked: settings.showSources, // Enable stacking only if showing sources
          },
          y: {
            title: {
              display: true,
              text: `${timeUnit} Spending (${formatCurrency(1).charAt(0)})`, // Just the currency symbol
            },
            beginAtZero: true,
            ticks: {
              callback: function (value) {
                return formatCurrency(value).replace(/\.\d+$/, ""); // Remove cents
              },
            },
            stacked: settings.showSources, // Enable stacking only if showing sources
          },
        },
        plugins: {
          tooltip: {
            enabled: true,
            mode: "index",
            intersect: false,
            callbacks: {
              label: function (context) {
                let label = context.dataset.label || "";
                if (label) {
                  label += ": ";
                }
                if (context.parsed.y !== null) {
                  if (Array.isArray(context.raw) && context.raw.length === 2) {
                    // Floating bar
                    label += `${formatCurrency(
                      context.raw[0]
                    )} - ${formatCurrency(context.raw[1])}`;
                  } else {
                    label += formatCurrency(context.parsed.y);
                  }
                }
                return label;
              },
              title: function (tooltipItems) {
                const yearIndex = tooltipItems[0].dataIndex;
                const age = startAge + yearIndex;
                const birthDate = new Date(settings.userBirthdate);
                const calendarYear = birthDate.getFullYear() + age; // Approximation
                return `Age: ${age} (Approx. ${calendarYear})`;
              },
            },
          },
          legend: {
            position: "top",
          },
        },
        interaction: {
          // For zoom/pan
          mode: "index",
          axis: "x",
          intersect: false,
        },
        // zoom: { // Requires chartjs-plugin-zoom
        //     pan: { enabled: true, mode: 'x' },
        //     zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x'}
        // }
      },
    };

    // If showing sources, and using stacked bars, Chart.js handles the "floating" nature
    // by having the bottom of the "risk" bar be the top of the "LMP" bar.
    // The `riskContributionRange` dataset should provide [min_risk_addition, max_risk_addition]
    // but Chart.js stacked bar expects single values that are stacked.
    // Simpler for stacked: LMP is one bar, risk is another bar on top.
    // For the range, it's harder. Let's adjust the "show sources" part:
    if (settings.showSources) {
      datasets.length = 0; // Clear again for a different approach to stacked percentile view

      // Data for LMP (fixed amount)
      const lmpDataSeries = Array(settings.horizonYears)
        .fill(null)
        .map((_, t_idx) => {
          return t_idx < settings.lmpYears ? settings.lmpAmount / divisor : 0;
        });

      // Data for Risk Portfolio percentiles (5th, median, 95th)
      const risk5thData = [],
        riskMedianData = [],
        risk95thData = [];
      resultsByYear.forEach((yearDataPoints) => {
        const riskSpendingValues = yearDataPoints.map(
          (dp) => dp.riskComponent / divisor
        );
        const p = calculatePercentiles(riskSpendingValues);
        risk5thData.push(p[0.05]);
        riskMedianData.push(p[0.5]);
        risk95thData.push(p[0.95]);
      });

      datasets.push({
        label: "LMP Guaranteed",
        data: lmpDataSeries,
        backgroundColor: "rgba(75, 192, 192, 0.6)", // Teal
        stack: "SpendingStack",
        order: 3,
      });
      datasets.push({
        label: "Risk Portfolio (5th Perc.)",
        data: risk5thData,
        backgroundColor: "rgba(255, 99, 132, 0.2)", // Light Red
        stack: "SpendingStack",
        order: 2,
      });
      datasets.push({
        // This will represent the difference between 50th and 5th for risk
        label: "Risk Portfolio (Median - 5th Perc.)",
        data: riskMedianData.map((m, idx) => Math.max(0, m - risk5thData[idx])),
        backgroundColor: "rgba(255, 159, 64, 0.5)", // Orange
        stack: "SpendingStack",
        order: 2,
      });
      datasets.push({
        // This will represent the difference between 95th and 50th for risk
        label: "Risk Portfolio (95th - Median Perc.)",
        data: risk95thData.map((m, idx) =>
          Math.max(0, m - riskMedianData[idx])
        ),
        backgroundColor: "rgba(255, 205, 86, 0.5)", // Yellow
        stack: "SpendingStack",
        order: 2,
      });
      // Total Median Line (LMP + Risk Median)
      datasets.push({
        label: "Total Median Spending",
        data: lmpDataSeries.map((lmp, idx) => lmp + riskMedianData[idx]),
        type: "line",
        borderColor: "#3e6482",
        fill: false,
        tension: 0.1,
        borderWidth: 2,
        pointRadius: 0,
        order: 1,
      });

      // Adjust tooltip for stacked view
      chartConfig.options.plugins.tooltip.callbacks.label = function (context) {
        let label = context.dataset.label || "";
        if (label) label += ": ";
        label += formatCurrency(context.parsed.y);

        // For stacked bars, show total for the stack
        if (
          context.dataset.stack === "SpendingStack" &&
          context.chart.isDatasetVisible(context.datasetIndex)
        ) {
          let total = 0;
          for (let i = 0; i < context.chart.data.datasets.length; i++) {
            const dataset = context.chart.data.datasets[i];
            if (
              dataset.stack === "SpendingStack" &&
              context.chart.isDatasetVisible(i)
            ) {
              const value = dataset.data[context.dataIndex];
              if (typeof value === "number") total += value;
            }
          }
          if (tooltipItemsBeingProcessed !== context.dataIndex) {
            // prevent multiple "Total"
            tooltipItemsBeingProcessed = context.dataIndex;
            return [label, `Total Stack: ${formatCurrency(total)}`];
          }
        }
        return label;
      };
      let tooltipItemsBeingProcessed = -1; // Helper for tooltip total
      chartConfig.options.plugins.tooltip.callbacks.afterBody = function () {
        tooltipItemsBeingProcessed = -1; // Reset after each tooltip draw
      };
    }

    spendingChart = new Chart(spendingChartCanvas, chartConfig);
  }
  let currentChartSettingsForRedraw = null; // Store settings used for the last chart draw

  // --- Data Export ---
  function exportToCsv(data, filename = "tpaw_simulation_data.csv") {
    if (data.length === 0) {
      alert("No data to export. Run a simulation first.");
      return;
    }
    const header = Object.keys(data[0]).join(",");
    const rows = data.map((row) => Object.values(row).join(","));
    const csvContent = `data:text/csv;charset=utf-8,${header}\n${rows.join(
      "\n"
    )}`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link); // Required for FF
    link.click();
    document.body.removeChild(link);
  }

  // --- Main Simulation Orchestration ---
  function runSimulation() {
    // Validate inputs
    const stockPct = parseFloatInput(inputs.stockPct);
    const bondPct = parseFloatInput(inputs.bondPct);
    if (Math.abs(stockPct + bondPct - 100) > 0.1) {
      // Allow for small float inaccuracies
      if (
        !confirm(
          `Stock % (${stockPct}%) + Bond % (${bondPct}%) does not equal 100%. Continue anyway?`
        )
      ) {
        return;
      }
    }
    if (parseIntInput(inputs.horizonYears) < parseIntInput(inputs.lmpYears)) {
      // LMP horizon can be longer than overall horizon, but LMP payments will only occur up to overall horizon.
      // It's more an issue if LMP horizon is shorter than what user expects for guaranteed income.
      // The LMP cost calc correctly uses min(lmpYears, horizonYears) for relevant period.
    }

    const settings = {
      userBirthdate: inputs.userBirthdate.value,
      lmpAmount: parseFloatInput(inputs.lmpAmount, 0),
      lmpRate: parseFloatInput(inputs.lmpRate, 0),
      lmpYears: parseIntInput(inputs.lmpYears, 30),
      startBalance: parseFloatInput(inputs.startBalance, 0),
      horizonYears: parseIntInput(inputs.horizonYears, 30),
      stockPct: stockPct,
      bondPct: bondPct,
      stockReturn: parseFloatInput(inputs.stockReturn, 7),
      stockSigma: parseFloatInput(inputs.stockSigma, 15),
      bondReturn: parseFloatInput(inputs.bondReturn, 2.5),
      bondSigma: parseFloatInput(inputs.bondSigma, 5),
      legacyTarget: parseFloatInput(inputs.legacyTarget, 0),
      nSims: parseIntInput(inputs.nSims, 1000),
      maxSpending: inputs.maxSpending.value
        ? parseFloatInput(inputs.maxSpending)
        : null,
      showSources: inputs.showSources.checked,
      displayMonthly: inputs.displayMonthly.checked,
      currentAge:
        new Date().getFullYear() -
        new Date(inputs.userBirthdate.value).getFullYear(),
    };
    currentChartSettingsForRedraw = settings; // Save for redraws

    // Disable button during sim
    runSimButton.disabled = true;
    runSimButton.textContent = "Simulating...";

    // Run simulation (potentially in a worker or timeout to avoid freezing UI for long sims)
    setTimeout(() => {
      const { resultsByYear, legacyOutcomes } = runMonteCarlo(settings);

      // Update legacy display
      const legacyPercentiles = calculatePercentiles(
        legacyOutcomes.map((l) => Math.max(0, l))
      ); // Ensure non-negative legacy display
      outputs.legacy5th.textContent = formatCurrency(legacyPercentiles[0.05]);
      outputs.legacy50th.textContent = formatCurrency(legacyPercentiles[0.5]);
      outputs.legacy95th.textContent = formatCurrency(legacyPercentiles[0.95]);

      updateChart(resultsByYear, settings);

      runSimButton.disabled = false;
      runSimButton.textContent = "Run Simulation";
    }, 10); // Small timeout to allow UI update before heavy computation
  }

  // --- Event Listeners ---
  runSimButton.addEventListener("click", runSimulation);
  exportCsvButton.addEventListener("click", () => exportToCsv(allSimData));

  inputs.showSources.addEventListener("change", () => {
    if (currentChartSettingsForRedraw && spendingChart) {
      // Only redraw if a simulation has been run
      currentChartSettingsForRedraw.showSources = inputs.showSources.checked;
      const { resultsByYear } = runMonteCarlo(currentChartSettingsForRedraw); // Re-run to get correct components if necessary, or just re-format. Simpler to re-run.
      updateChart(resultsByYear, currentChartSettingsForRedraw);
    }
  });
  inputs.displayMonthly.addEventListener("change", () => {
    if (currentChartSettingsForRedraw && spendingChart) {
      currentChartSettingsForRedraw.displayMonthly =
        inputs.displayMonthly.checked;
      const { resultsByYear } = runMonteCarlo(currentChartSettingsForRedraw); // Re-run is easiest way to ensure divisor is applied everywhere
      updateChart(resultsByYear, currentChartSettingsForRedraw);
    }
  });

  // Auto-adjust bond percentage based on stock percentage
  inputs.stockPct.addEventListener("change", () => {
    const stockVal = parseFloatInput(inputs.stockPct, 60);
    if (stockVal >= 0 && stockVal <= 100) {
      inputs.bondPct.value = 100 - stockVal;
    }
  });
  inputs.bondPct.addEventListener("change", () => {
    const bondVal = parseFloatInput(inputs.bondPct, 40);
    if (bondVal >= 0 && bondVal <= 100) {
      inputs.stockPct.value = 100 - bondVal;
    }
  });

  // Initial run with default values (optional)
  // runSimulation();
});
