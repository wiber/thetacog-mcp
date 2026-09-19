// lattice.rs — THE LATTICE CLASSIFIER: every one of the 144 cells decided on the metal, once, as a byte.
//
// Operator (2026-09-11): "rust can feed the actual encircled panel and decide what each is … rust
// encircled panel to the emojis here may be the best." Until this file the band of a walked cell was
// decided in Node (shortlex-coords.mjs toleranceBand — the same Chebyshev-to-fence test) and the
// emoji grid was string-munged from three JS arrays. Now the walker emits a 144-byte CellState array
// (row-major over SHORTLEX 12×12: index = row*12 + col) plus the pull target and the red-mass centroid,
// and Node only chooses glyphs. The byte array — not a glyph stream — is what rides the tape:
// classification is data, a font is presentation.
//
//   pmu-onchip --lattice --pixel B,C1 --fence 0,3,1,5 --cells A,B;A,C;A,A1;…
//   → {"cells":[0,0,2,…144],"pull_target":[r,c],"centroid":[r,c],"counts":{"green":..,"amber":..,"red":..}}
//
// CellState (u8): 0 Cold (outside fence, unwalked) · 1 Fence (inside fence, unwalked) · 2 OnLane
// (walked, inside the fence) · 3 Adjacent (walked, Chebyshev 1 from the fence) · 4 OffLane (walked,
// ≥2 from the fence) · 5 Pixel (the placed coordinate). The fence test is IDENTICAL to Node's
// fenceDist (max of the row/col overshoot), so the PNG, the caption and this array cannot disagree.
use crate::ballistic::SHORTLEX;

pub const SIDE: usize = 12;
pub const CELLS: usize = SIDE * SIDE;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CellState { Cold = 0, Fence = 1, OnLane = 2, Adjacent = 3, OffLane = 4, Pixel = 5 }

#[derive(Copy, Clone, Debug)]
pub struct FenceBox { pub r0: usize, pub r1: usize, pub c0: usize, pub c1: usize }

/// The 12 axis labels in ShortLex order (SHORTLEX[i] is the pair for cell i; its column label is SHORTLEX[i] mod 12).
pub fn axis_index(label: &str) -> Option<usize> {
    // SHORTLEX: length first, then lex — the same order SHORTLEX[] pairs enumerate (A,A A,B A,C A,A1 …)
    const AXIS: [&str; SIDE] = ["A", "B", "C", "A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"];
    AXIS.iter().position(|a| *a == label)
}

/// "B,C1" → (row, col) in lattice index space.
pub fn coord_rc(coord: &str) -> Option<(usize, usize)> {
    let mut it = coord.split(',');
    let r = axis_index(it.next()?.trim())?;
    let c = axis_index(it.next()?.trim())?;
    Some((r, c))
}

/// Chebyshev distance from the fence box — 0 inside, 1 adjacent, ≥2 off. Same arithmetic as Node's fenceDist.
pub fn fence_dist(r: usize, c: usize, f: &FenceBox) -> usize {
    let dr = if r < f.r0 { f.r0 - r } else if r > f.r1 { r - f.r1 } else { 0 };
    let dc = if c < f.c0 { f.c0 - c } else if c > f.c1 { c - f.c1 } else { 0 };
    dr.max(dc)
}

pub struct Lattice {
    pub cells: [u8; CELLS],
    pub pull_target: Option<(usize, usize)>,
    pub centroid: Option<(f32, f32)>,
    pub green: usize, pub amber: usize, pub red: usize,
}

/// Classify every cell: walked coords against the fence, the pixel on top, the fence interior for the unwalked.
pub fn classify(pixel: Option<(usize, usize)>, fence: Option<FenceBox>, walked: &[(usize, usize)]) -> Lattice {
    let mut cells = [CellState::Cold as u8; CELLS];
    if let Some(f) = fence {
        for r in f.r0..=f.r1.min(SIDE - 1) { for c in f.c0..=f.c1.min(SIDE - 1) { cells[r * SIDE + c] = CellState::Fence as u8; } }
    }
    let (mut green, mut amber, mut red) = (0usize, 0usize, 0usize);
    let mut reds: Vec<(usize, usize)> = Vec::new();
    for &(r, c) in walked {
        if r >= SIDE || c >= SIDE { continue; }
        let state = match fence { Some(f) => match fence_dist(r, c, &f) { 0 => CellState::OnLane, 1 => CellState::Adjacent, _ => CellState::OffLane }, None => CellState::OffLane };
        match state { CellState::OnLane => green += 1, CellState::Adjacent => amber += 1, _ => { red += 1; reds.push((r, c)); } }
        cells[r * SIDE + c] = state as u8;
    }
    if let Some((r, c)) = pixel { if r < SIDE && c < SIDE { cells[r * SIDE + c] = CellState::Pixel as u8; } }
    // the red-mass centroid and the nearest red cell to it — the pull target
    let (centroid, pull_target) = if reds.is_empty() { (None, None) } else {
        let n = reds.len() as f32;
        let cr = reds.iter().map(|x| x.0 as f32).sum::<f32>() / n;
        let cc = reds.iter().map(|x| x.1 as f32).sum::<f32>() / n;
        let near = reds.iter().copied().min_by(|a, b| {
            let da = (a.0 as f32 - cr).hypot(a.1 as f32 - cc);
            let db = (b.0 as f32 - cr).hypot(b.1 as f32 - cc);
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        });
        (Some((cr, cc)), near)
    };
    Lattice { cells, pull_target, centroid, green, amber, red }
}

pub fn to_json(l: &Lattice) -> String {
    let cells: Vec<String> = l.cells.iter().map(|b| b.to_string()).collect();
    let pt = match l.pull_target { Some((r, c)) => format!("[{},{}]", r, c), None => "null".into() };
    let ct = match l.centroid { Some((r, c)) => format!("[{:.2},{:.2}]", r, c), None => "null".into() };
    let ptl = match l.pull_target { Some((r, c)) => format!("\"{}\"", SHORTLEX[r * SIDE + c]), None => "null".into() };
    format!("{{\"cells\":[{}],\"pull_target\":{},\"pull_label\":{},\"centroid\":{},\"counts\":{{\"green\":{},\"amber\":{},\"red\":{}}}}}",
        cells.join(","), pt, ptl, ct, l.green, l.amber, l.red)
}

/// CLI: --lattice --pixel B,C1 --fence r0,r1,c0,c1 --cells A,B;A,C;…
pub fn run(args: &[String]) {
    let val = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let pixel = val("--pixel").and_then(|p| coord_rc(&p));
    let fence = val("--fence").and_then(|f| {
        let v: Vec<usize> = f.split(',').filter_map(|x| x.trim().parse().ok()).collect();
        if v.len() == 4 { Some(FenceBox { r0: v[0], r1: v[1], c0: v[2], c1: v[3] }) } else { None }
    });
    let walked: Vec<(usize, usize)> = val("--cells").map(|s| s.split(';').filter_map(|c| coord_rc(c.trim())).collect()).unwrap_or_default();
    println!("{}", to_json(&classify(pixel, fence, &walked)));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fence_bands_match_node() {
        let f = FenceBox { r0: 0, r1: 3, c0: 1, c1: 5 };
        assert_eq!(fence_dist(0, 1, &f), 0); assert_eq!(fence_dist(4, 1, &f), 1); assert_eq!(fence_dist(6, 0, &f), 3);
        assert_eq!(axis_index("B"), Some(1)); assert_eq!(axis_index("A1"), Some(3)); assert_eq!(coord_rc("B,C3"), Some((1, 11)));
    }
    #[test]
    fn classify_is_row_major_and_pixel_wins() {
        let f = FenceBox { r0: 0, r1: 3, c0: 1, c1: 5 };
        let l = classify(Some((4, 1)), Some(f), &[(0, 1), (4, 1), (8, 9)]);
        assert_eq!(l.cells[0 * 12 + 1], CellState::OnLane as u8);
        assert_eq!(l.cells[4 * 12 + 1], CellState::Pixel as u8);   // walked AND the pixel → pixel wins
        assert_eq!(l.cells[8 * 12 + 9], CellState::OffLane as u8);
        assert_eq!(l.cells[0 * 12 + 0], CellState::Cold as u8);
        assert_eq!(l.cells[1 * 12 + 2], CellState::Fence as u8);
        assert_eq!((l.green, l.amber, l.red), (1, 1, 1));
        assert_eq!(l.pull_target, Some((8, 9)));
    }
}
