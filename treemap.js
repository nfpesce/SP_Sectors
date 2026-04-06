// Squarified Treemap Algorithm (Bruls, Huizing, van Wijk, 2000)
// Takes items with a `weight` property and a bounding rectangle,
// returns items with added x, y, w, h properties.

function squarify(items, rect) {
  if (!items.length) return [];

  // Normalize weights so they sum to the total area
  const totalWeight = items.reduce((s, d) => s + d.weight, 0);
  const totalArea = rect.w * rect.h;
  const scaled = items
    .map(d => ({ ...d, area: (d.weight / totalWeight) * totalArea }))
    .sort((a, b) => b.area - a.area); // descending

  const result = [];
  layoutStrip(scaled, { ...rect }, result);
  return result;
}

function layoutStrip(items, rect, result) {
  if (items.length === 0) return;
  if (items.length === 1) {
    result.push({ ...items[0], x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    return;
  }

  const shortSide = Math.min(rect.w, rect.h);
  let row = [items[0]];
  let remaining = items.slice(1);

  for (let i = 1; i < items.length; i++) {
    const candidate = [...row, items[i]];
    if (worstRatio(candidate, shortSide) <= worstRatio(row, shortSide)) {
      row.push(items[i]);
      remaining = items.slice(i + 1);
    } else {
      remaining = items.slice(i);
      break;
    }
  }

  // Lay out the row and get the remaining rectangle
  const newRect = placeRow(row, rect, result);
  layoutStrip(remaining, newRect, result);
}

function worstRatio(row, sideLength) {
  const totalArea = row.reduce((s, d) => s + d.area, 0);
  const rowLength = totalArea / sideLength;
  let worst = 0;
  for (const item of row) {
    const itemSide = item.area / rowLength;
    const ratio = Math.max(rowLength / itemSide, itemSide / rowLength);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

function placeRow(row, rect, result) {
  const totalArea = row.reduce((s, d) => s + d.area, 0);
  const horizontal = rect.w >= rect.h; // lay along the shorter side

  if (horizontal) {
    // Row fills from the left, taking a vertical strip
    const stripWidth = totalArea / rect.h;
    let y = rect.y;
    for (const item of row) {
      const itemHeight = item.area / stripWidth;
      result.push({ ...item, x: rect.x, y, w: stripWidth, h: itemHeight });
      y += itemHeight;
    }
    return { x: rect.x + stripWidth, y: rect.y, w: rect.w - stripWidth, h: rect.h };
  } else {
    // Row fills from the top, taking a horizontal strip
    const stripHeight = totalArea / rect.w;
    let x = rect.x;
    for (const item of row) {
      const itemWidth = item.area / stripHeight;
      result.push({ ...item, x, y: rect.y, w: itemWidth, h: stripHeight });
      x += itemWidth;
    }
    return { x: rect.x, y: rect.y + stripHeight, w: rect.w, h: rect.h - stripHeight };
  }
}
