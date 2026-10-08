const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: {
    // Service worker (background)
    background: path.resolve(__dirname, 'src/background/service-worker.ts'),
    // Content script
    content: path.resolve(__dirname, 'src/content/tracker.ts'),
    // Popup
    popup: path.resolve(__dirname, 'src/popup/popup.ts'),
    // Dashboard
    dashboard: path.resolve(__dirname, 'src/dashboard/dashboard.ts'),
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    // Popup HTML
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/popup/popup.html'),
      filename: 'popup.html',
      chunks: ['popup'],
      // Inject popup.css link manually via template
    }),
    // Dashboard HTML
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/dashboard/dashboard.html'),
      filename: 'dashboard.html',
      chunks: ['dashboard'],
    }),
    // Copy static files
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'icons', to: 'icons', noErrorOnMissing: true },
        // Copy CSS files that HTML references directly
        {
          from: 'src/popup/popup.css',
          to: 'popup.css',
        },
        {
          from: 'src/dashboard/dashboard.css',
          to: 'dashboard.css',
        },
      ],
    }),
  ],
  // Service workers cannot be bundled with other chunks
  optimization: {
    splitChunks: false,
  },
};
