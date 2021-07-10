#/bin/bash

rsync -avzh --delete --exclude "*.sh" --exclude "module.json" * /dockerconfig/foundrytest/Data/modules/elevationruler/ 
