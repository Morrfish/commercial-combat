/* Image path lookup. On a computer (index.html opened from the folder) every path is used as-is.
   The web build (tools/build_web.py) packs the images into a few js/pack-*.js files, because the
   hosted link allows only a limited number of files; then CCA() returns the packed image instead. */
window.CCA = function (p) { var P = window.CC_PACK; return (P && P[p]) || p; };
