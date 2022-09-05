#/bin/bash

rsync -avzh --delete \
	--exclude "*.sh" \
	--exclude "module.json" \
	* /Users/rhead/FoundryV10/foundrydata/Data/modules/elevationruler/ 
