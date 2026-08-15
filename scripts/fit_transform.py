import json, re

matched = json.load(open('buildings_matched.json'))

def grid_to_xy(grid):
    m = re.match(r'^([A-H])(\d{1,2})$', grid)
    if not m:
        return None
    col = ord(m.group(1)) - ord('A')
    row = int(m.group(2))
    return col, row

pts = []
for b in matched:
    xy = grid_to_xy(b['grid'])
    if xy:
        pts.append((xy[0], xy[1], b['lat'], b['lng']))

print(f"Calibration points: {len(pts)}")

def solve3(A, bvec):
    # Gaussian elimination for 3x3 system A x = b
    M = [row[:] + [bvec[i]] for i, row in enumerate(A)]
    n = 3
    for i in range(n):
        piv = max(range(i, n), key=lambda r: abs(M[r][i]))
        M[i], M[piv] = M[piv], M[i]
        for r in range(i + 1, n):
            f = M[r][i] / M[i][i]
            for c in range(i, n + 1):
                M[r][c] -= f * M[i][c]
    x = [0, 0, 0]
    for i in range(n - 1, -1, -1):
        s = M[i][n] - sum(M[i][j] * x[j] for j in range(i + 1, n))
        x[i] = s / M[i][i]
    return x

def fit(pts, target_idx):
    # target = a*col + b*row + c, least squares over pts
    Sxx = Sxy = Sx = Syy = Sy = Sn = 0.0
    Sxt = Syt = St = 0.0
    for col, row, lat, lng in pts:
        t = lat if target_idx == 0 else lng
        Sxx += col * col; Sxy += col * row; Sx += col
        Syy += row * row; Sy += row; Sn += 1
        Sxt += col * t; Syt += row * t; St += t
    A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, Sn]]
    b = [Sxt, Syt, St]
    return solve3(A, b)

lat_coef = fit(pts, 0)
lng_coef = fit(pts, 1)
print("lat = %.8f*col + %.8f*row + %.6f" % tuple(lat_coef))
print("lng = %.8f*col + %.8f*row + %.6f" % tuple(lng_coef))

# residuals
errs = []
for col, row, lat, lng in pts:
    plat = lat_coef[0]*col + lat_coef[1]*row + lat_coef[2]
    plng = lng_coef[0]*col + lng_coef[1]*row + lng_coef[2]
    # approx meters error
    dlat = (plat - lat) * 111320
    dlng = (plng - lng) * 111320 * 0.7809  # cos(38.98deg)
    errs.append((dlat**2 + dlng**2) ** 0.5)
errs.sort()
print(f"Median residual: {errs[len(errs)//2]:.1f} m, max: {errs[-1]:.1f} m, mean: {sum(errs)/len(errs):.1f} m")

json.dump({'lat_coef': lat_coef, 'lng_coef': lng_coef}, open('grid_transform.json', 'w'), indent=2)
