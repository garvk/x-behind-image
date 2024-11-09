{ pkgs }: {
  deps = [
    pkgs.nodejs
    pkgs.nodePackages.typescript-language-server
    pkgs.yarn
    pkgs.pkg-config
    pkgs.libpng
    pkgs.cairo
    pkgs.pango
    pkgs.libjpeg
    pkgs.giflib
    pkgs.librsvg
    pkgs.pixman
    pkgs.libuuid
  ];
  env = { LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [pkgs.libuuid];  };
}